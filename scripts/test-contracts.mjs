// End-to-end contract test against a local chain (npm run chain:local, then deploy with RPC_URL=http://127.0.0.1:8545).
// Uses Hardhat's public test accounts #1 (borrower) and #2 (liquidator).
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as snarkjs from "snarkjs";

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const chain = defineChain({ id: D.chainId, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [D.rpcUrl] } } });
const pub = createPublicClient({ chain, transport: http() });
const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") });
const user = createWalletClient({ chain, transport: http(), account: privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") });
const liq = createWalletClient({ chain, transport: http(), account: privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a") });

const SPY = D.tokens.SPY.address;
const { vault, oracle, usdg, verifier } = D.contracts;
let pass = 0;
let fail = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  ok ? pass++ : fail++;
};
const tx = async (w, address, name, fn, args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi: A[name].abi, functionName: fn, args }) });
const read = (address, name, fn, args = []) => pub.readContract({ address, abi: A[name].abi, functionName: fn, args });
const reverts = async (p) => {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
};
const hf = async () => Number(formatEther(await read(vault, "NightshiftVault", "healthFactor", [user.account.address, SPY])));

// 1. faucet
await tx(user, SPY, "TestToken", "faucet", []);
check("faucet gives 10 tSPY", (await read(SPY, "TestToken", "balanceOf", [user.account.address])) === parseEther("10"));
check("faucet cooldown enforced", await reverts(user.writeContract({ address: SPY, abi: A.TestToken.abi, functionName: "faucet", args: [] })));

// 2. deposit + borrow
await tx(user, SPY, "TestToken", "approve", [vault, parseEther("10")]);
await tx(user, vault, "NightshiftVault", "deposit", [SPY, parseEther("10")]);
const [price, conf] = await read(oracle, "NightshiftOracle", "getPrice", [SPY]);
const limit = await read(vault, "NightshiftVault", "borrowLimit", [user.account.address, SPY]);
const expected = (10 * Number(formatEther(price)) * 0.77 * (1 - (100 - conf) / 200));
check("borrow limit = value × LLTV × confidence haircut", Math.abs(Number(formatEther(limit)) - expected) < 0.01, `${Number(formatEther(limit)).toFixed(2)} vs ${expected.toFixed(2)}`);
check("borrowing over the limit reverts", await reverts(user.writeContract({ address: vault, abi: A.NightshiftVault.abi, functionName: "borrow", args: [SPY, limit + parseEther("1")] })));
const borrowAmt = (limit * 95n) / 100n;
await tx(user, vault, "NightshiftVault", "borrow", [SPY, borrowAmt]);
check("borrow sends tUSDG", (await read(usdg, "TestToken", "balanceOf", [user.account.address])) === borrowAmt);
check("health factor above 1 after borrowing", (await hf()) > 1, (await hf()).toFixed(3));

// 3. adapter (Morpho IOracle shape)
const morphoPrice = await read(D.tokens.SPY.adapter, "MorphoOracleAdapter", "price");
check("Morpho adapter price() = price × 1e18 (1e36 scale)", morphoPrice === price * 10n ** 18n);

// 4. guardian: opt in, drop price 8%, protect
check("protect refuses before the borrower opts in", await reverts(liq.writeContract({ address: vault, abi: A.NightshiftVault.abi, functionName: "protect", args: [user.account.address, SPY] })));
await tx(user, vault, "NightshiftVault", "setRule", [SPY, 2, parseEther("1.15"), parseEther("1.4")]);
const dropped = (price * 92n) / 100n;
await tx(owner, oracle, "NightshiftOracle", "setPrices", [[SPY], [dropped], [conf]]);
const before = await hf();
await tx(liq, vault, "NightshiftVault", "protect", [user.account.address, SPY]);
const after = await hf();
check("Guardian protect restores HF to target 1.40", Math.abs(after - 1.4) < 0.001, `${before.toFixed(3)} → ${after.toFixed(3)}`);
check("non-updater cannot set prices", await reverts(user.writeContract({ address: oracle, abi: A.NightshiftOracle.abi, functionName: "setPrices", args: [[SPY], [1n], [50]] })));

// 5. liquidation after a crash: a 40% move is skipped by the oracle's move limit, then confirmed by the owner
const beforeCrash = (await read(oracle, "NightshiftOracle", "getPrice", [SPY]))[0];
await tx(owner, oracle, "NightshiftOracle", "setPrices", [[SPY], [(price * 60n) / 100n], [conf]]);
check("oracle skips a 40% jump from a normal update", (await read(oracle, "NightshiftOracle", "getPrice", [SPY]))[0] === beforeCrash);
await tx(owner, oracle, "NightshiftOracle", "forceSetPrices", [[SPY], [(price * 60n) / 100n], [conf]]);
check("HF below 1 after a 40% crash", (await hf()) < 1, (await hf()).toFixed(3));
await tx(owner, usdg, "TestToken", "mint", [liq.account.address, parseEther("100000")]);
await tx(liq, usdg, "TestToken", "approve", [vault, parseEther("100000")]);
const [, debtBefore] = await read(vault, "NightshiftVault", "positions", [user.account.address, SPY]);
await tx(liq, vault, "NightshiftVault", "liquidate", [user.account.address, SPY, debtBefore / 2n]);
const seized = await read(SPY, "TestToken", "balanceOf", [liq.account.address]);
const lif = Number(formatEther(await read(vault, "NightshiftVault", "lif", [parseEther("0.77")])));
const expSeized = (Number(formatEther(debtBefore / 2n)) * lif) / (Number(formatEther(price)) * 0.6);
check("liquidator receives debt × LIF in collateral", Math.abs(Number(formatEther(seized)) - expSeized) < 0.001, `LIF ${lif.toFixed(4)}`);

// 6. on-chain ZK verifier with a real proof
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { priceCents: "77846", lltvBps: "7700", units: "100000", debtCents: "300000", salt: "99" },
  "public/zk/solvency.wasm",
  "public/zk/solvency_final.zkey",
);
const toArgs = (sig) => [
  [proof.pi_a[0], proof.pi_a[1]],
  [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ],
  [proof.pi_c[0], proof.pi_c[1]],
  sig,
];
check("on-chain verifier accepts a real proof", await read(verifier, "Groth16Verifier", "verifyProof", toArgs(publicSignals)));
check("on-chain verifier rejects a forged price", !(await read(verifier, "Groth16Verifier", "verifyProof", toArgs([publicSignals[0], "155692", publicSignals[2]]))));

const [users] = await read(vault, "NightshiftVault", "getPositions", [0n, 10n]);
check("position registry lists the borrower", users[0].toLowerCase() === user.account.address.toLowerCase());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
