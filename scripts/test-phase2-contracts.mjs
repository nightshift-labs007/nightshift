// Tests for the contract changes from the security review, on a local Hardhat chain with fresh deployments:
// Chainlink-style feed, Morpho adapter staleness, Vault confidence decay / max price age / reentrancy guard,
// and CloakRegistry (proof + on-chain price and LLTV). Run: node scripts/test-phase2-contracts.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import solc from "solc";
import * as snarkjs from "snarkjs";
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PORT = 8548;
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const node = spawn(process.execPath, ["node_modules/hardhat/internal/cli/cli.js", "node", "--config", "hardhat.config.cjs", "--port", String(PORT)], { stdio: "ignore" });
const chain = defineChain({ id: 31337, name: "p2", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [`http://127.0.0.1:${PORT}`] } } });
const transport = http(`http://127.0.0.1:${PORT}`);
const pub = createPublicClient({ chain, transport, pollingInterval: 50 });
const test = createTestClient({ chain, transport, mode: "hardhat" });
for (let i = 0; ; i++) {
  try { await pub.getChainId(); break; } catch { if (i > 120) throw new Error("no node"); await new Promise((r) => setTimeout(r, 500)); }
}
const owner = createWalletClient({ chain, transport, account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") });
const user = createWalletClient({ chain, transport, account: privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") });
let pass = 0, fail = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); ok ? pass++ : fail++; };
const deploy = async (abi, bytecode, args) => (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi, bytecode, args }) })).contractAddress;
const dep = (name, args) => deploy(A[name].abi, A[name].bytecode, args);
const send = async (w, address, abi, functionName, args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args }) });
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const reason = async (w, address, abi, functionName, args) => {
  try { await pub.simulateContract({ account: w.account, address, abi, functionName, args }); return null; }
  catch (e) { const f = e.walk?.((x) => typeof x?.reason === "string"); return f?.reason ?? String(e.shortMessage).slice(0, 100); }
};
const later = async (seconds) => { await test.increaseTime({ seconds }); await test.mine({ blocks: 1 }); };

const usdg = await dep("TestToken", ["USDG", "USDG", 0n]);
const spy = await dep("TestToken", ["SPY", "SPY", 0n]);
const oracle = await dep("NightshiftOracle", []);
const vault = await dep("NightshiftVault", [usdg, oracle]);
const verifier = await dep("Groth16Verifier", []);
await send(owner, vault, A.NightshiftVault.abi, "setMarket", [spy, parseEther("0.77"), true]);
await send(owner, usdg, A.TestToken.abi, "mint", [vault, parseEther("1000000")]);
await send(owner, oracle, A.NightshiftOracle.abi, "setPrices", [[spy], [parseEther("775.07")], [96]]);

// ---------------------------------------------------------------- Chainlink-style feed
const feed = await dep("NightshiftAggregatorV3", [oracle, spy, "dSPY / USD (Nightshift fair value)"]);
const F = A.NightshiftAggregatorV3.abi;
const [roundId, answer, , updatedAt] = await read(feed, F, "latestRoundData");
check("AggregatorV3: 8 decimals", (await read(feed, F, "decimals")) === 8);
check("AggregatorV3: answer = price in 8 decimals", answer === 77507000000n, String(answer));
check("AggregatorV3: roundId and updatedAt = the update time", roundId === updatedAt && updatedAt > 0n);
check("AggregatorV3: confidence() exposes Nightshift's score", (await read(feed, F, "confidence")) === 96);
check("AggregatorV3: getRoundData for an old round reverts (no history)", (await reason(owner, feed, F, "getRoundData", [roundId - 1n])) === "no history");
check("AggregatorV3: description", (await read(feed, F, "description")) === "dSPY / USD (Nightshift fair value)");

// ---------------------------------------------------------------- Morpho adapter staleness
const adapter = await dep("MorphoOracleAdapter", [oracle, spy, 86400n]);
const M = A.MorphoOracleAdapter.abi;
check("Morpho adapter: fresh price → price × 1e18", (await read(adapter, M, "price")) === parseEther("775.07") * 10n ** 18n);

// ---------------------------------------------------------------- Vault: confidence decay and max price age
const V = A.NightshiftVault.abi, T = A.TestToken.abi;
await send(owner, spy, T, "mint", [user.account.address, parseEther("10")]);
await send(user, spy, T, "approve", [vault, parseEther("10")]);
await send(user, vault, V, "deposit", [spy, parseEther("10")]);
const limit0 = await read(vault, V, "borrowLimit", [user.account.address, spy]);
await later(10 * 3600 + 5);
const limit10 = await read(vault, V, "borrowLimit", [user.account.address, spy]);
// confidence 96 → 86 after 10 h: haircut 0.98 → 0.93
const expected = (Number(limit0) * (1 - (100 - 86) / 200)) / (1 - (100 - 96) / 200);
check("Vault: confidence decays 1 point per hour without an update (borrow limit shrinks)", Math.abs(Number(limit10) / expected - 1) < 1e-9, `${(Number(limit0) / 1e18).toFixed(2)} → ${(Number(limit10) / 1e18).toFixed(2)}`);
check("Morpho adapter: price older than maxAge (1 day) reverts", (await (async () => { await later(15 * 3600); return reason(owner, adapter, M, "price", []); })()) === "stale price");
await later(24 * 3600); // 49 h since the update: past MAX_PRICE_AGE (2 days)
check("Vault: borrowing on a price older than 2 days is refused", (await reason(user, vault, V, "borrow", [spy, parseEther("1")])) === "stale price");
check("Vault: valuing collateral on a 2-day-old price reverts (stale)", await (async () => { try { await read(vault, V, "collateralValue", [user.account.address, spy]); return false; } catch { return true; } })());
await send(owner, oracle, A.NightshiftOracle.abi, "forceSetPrices", [[spy], [parseEther("775.07")], [96]]);

// ---------------------------------------------------------------- Vault: reentrancy guard (a token that calls back)
const attackerSrc = `
pragma solidity ^0.8.26;
interface IVault { function repay(address collateral, uint256 amount) external; }
contract HookToken {
  mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
  address public vault; address public collateral; bool public attack; string public lastError;
  function mint(address to, uint256 v) external { balanceOf[to] += v; }
  function arm(address v, address c) external { vault = v; collateral = c; attack = true; }
  function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
  function transfer(address to, uint256 v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[to] += v; return true; }
  function transferFrom(address f, address to, uint256 v) external returns (bool) {
    if (attack) { attack = false; try IVault(vault).repay(collateral, 1) {} catch Error(string memory r) { lastError = r; } }
    allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[to] += v; return true;
  }
}`;
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "H.sol": { content: attackerSrc } }, settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
const H = out.contracts["H.sol"].HookToken;
const hook = await deploy(H.abi, `0x${H.evm.bytecode.object}`, []);
const vault2 = await dep("NightshiftVault", [hook, oracle]);
await send(owner, vault2, V, "setMarket", [spy, parseEther("0.77"), true]);
await send(owner, hook, H.abi, "mint", [vault2, parseEther("100000")]);
await send(owner, spy, T, "mint", [user.account.address, parseEther("10")]);
await send(user, spy, T, "approve", [vault2, parseEther("10")]);
await send(user, vault2, V, "deposit", [spy, parseEther("10")]);
await send(user, vault2, V, "borrow", [spy, parseEther("1000")]);
await send(user, hook, H.abi, "approve", [vault2, parseEther("1000")]);
await send(owner, hook, H.abi, "arm", [vault2, spy]);
await send(user, vault2, V, "repay", [spy, parseEther("500")]);
check("Vault: a token callback can't re-enter (reentrancy guard)", (await read(hook, H.abi, "lastError")) === "reentrant", await read(hook, H.abi, "lastError"));
const [, debtLeft] = await read(vault2, V, "positions", [user.account.address, spy]);
check("Vault: debt accounting intact after the blocked re-entry", debtLeft === parseEther("500"), `${Number(debtLeft) / 1e18}`);

// ---------------------------------------------------------------- CloakRegistry
const registry = await dep("CloakRegistry", [verifier, oracle, vault]);
const R = A.CloakRegistry.abi;
const proveAt = async (priceCents, lltvBps) => {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { priceCents: String(priceCents), lltvBps: String(lltvBps), units: "100000", debtCents: "200000", salt: "987654321" },
    "public/zk/solvency.wasm", "public/zk/solvency_final.zkey");
  return [spy, [proof.pi_a[0], proof.pi_a[1]], [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]], [proof.pi_c[0], proof.pi_c[1]], publicSignals]
    .map((x, i) => (i === 0 ? x : x.map((y) => (Array.isArray(y) ? y.map(BigInt) : BigInt(y)))));
};
const honest = await proveAt(77507, 7700);
const [ok1, why1] = await read(registry, R, "check", honest);
check("CloakRegistry: honest proof at the Oracle price is accepted", ok1 && why1 === "", why1);
await send(user, registry, R, "attest", honest);
const att = await read(registry, R, "attestations", [honest[4][0]]);
check("CloakRegistry: attest records the proof by its commitment", att[0].toLowerCase() === spy.toLowerCase() && att[1] === 77507n);
const fake = await proveAt(155014, 7700);
check("CloakRegistry: valid proof at a made-up 2x price is refused", (await read(registry, R, "check", fake))[1] === "price differs from oracle");
const wrongL = await proveAt(77507, 9000);
check("CloakRegistry: proof using a different LLTV is refused", (await read(registry, R, "check", wrongL))[1] === "lltv differs from market");
const broken = honest.map((x, i) => (i === 1 ? [x[0] + 1n, x[1]] : x));
check("CloakRegistry: tampered proof is refused", (await read(registry, R, "check", broken))[1] === "invalid proof");
check("CloakRegistry: attest of a refused proof reverts", (await reason(user, registry, R, "attest", fake)) === "price differs from oracle");

node.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
