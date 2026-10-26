// Randomised and adversarial tests for StackPlan on a local chain:
//   npx hardhat node --config hardhat.config.cjs   (in another terminal)
//   node scripts/fuzz-stack.mjs [rounds=150] [seed]
// Each round draws a random Oracle price, confidence, price age, pool spread, plan premium and amount, then checks:
//   the buy goes through exactly when it should (fresh price, enough confidence, pool within the allowed premium);
//   S1  a filled buy never pays more than fair value × (1 + max premium);
//   S2  a plan never spends more than its budget, and one run spends exactly its amount;
//   S6  the bought tokens reach the plan owner, and StackPlan keeps nothing and leaves no allowance behind.
// Then three hostile venues: one that lies about how much it delivered, one that tries to take more than one
// installment, and one that calls back into execute() (reentrancy).
import fs from "node:fs";
import solc from "solc";
import { createPublicClient, createWalletClient, http, parseEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROUNDS = Number(process.argv[2] ?? 150);
let seed = Number(process.argv[3] ?? Date.now() % 1e9);
console.log(`fuzzing ${ROUNDS} rounds, seed ${seed} (rerun with the same seed to reproduce)`);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (lo, hi) => Math.floor(lo + rand() * (hi - lo + 1));

const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const pub = createPublicClient({ chain, transport: http() });
const KEYS = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"];
const [owner, user, keeper] = KEYS.map((k) => createWalletClient({ chain, transport: http(), account: privateKeyToAccount(k) }));
const E = parseEther;
const BPS = 10_000n, WAD = 10n ** 18n;

let pass = 0, fail = 0;
const failures = [];
const check = (label, ok, extra = "") => { if (ok) pass++; else { fail++; failures.push(`${label} ${extra}`); console.log(`FAIL  ${label} ${extra}`); } };
const tx = async (w, address, abi, functionName, args = []) => { const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args }) }); if (r.status !== "success") throw new Error(`${functionName} failed`); return r; };
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const deploy = async (abi, bytecode, args = []) => (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi, bytecode, args }) })).contractAddress;
const now = async () => Number((await pub.getBlock()).timestamp);
const jump = async (s) => { await pub.request({ method: "evm_increaseTime", params: [s] }); await pub.request({ method: "evm_mine", params: [] }); };
const tryExec = async (w, plan, id) => { try { await pub.simulateContract({ address: plan, abi: A.StackPlan.abi, functionName: "execute", args: [id], account: w.account }); } catch (e) { return { ok: false, why: e.cause?.reason ?? e.shortMessage }; } await tx(w, plan, A.StackPlan.abi, "execute", [id]); return { ok: true }; };

const T = A.TestToken, O = A.NightshiftOracle, SP = A.StackPlan, PL = A.StackDemoPool;
const usdg = await deploy(T.abi, T.bytecode, ["Demo USDG", "dUSDG", E("1000")]);
const gld = await deploy(T.abi, T.bytecode, ["Demo GLD", "dGLD", E("20")]);
const oracle = await deploy(O.abi, O.bytecode);
const pool = await deploy(PL.abi, PL.bytecode, [usdg, oracle]);
const plan = await deploy(SP.abi, SP.bytecode, [usdg, oracle, pool]);
const CAP = 100; // premium cap for the fuzzed asset: 1%
await tx(owner, gld, T.abi, "mint", [pool, E("100000000")]);
await tx(owner, usdg, T.abi, "mint", [user.account.address, E("100000000")]);
await tx(owner, plan, SP.abi, "setAsset", [gld, true, CAP]);
await tx(user, usdg, T.abi, "approve", [plan, E("100000000")]);

// ---------------------------------------------------------------- random rounds
const tally = { filled: 0, refused: 0 };
for (let r = 0; r < ROUNDS; r++) {
  const price = E(String(pick(1, 5000))) + BigInt(pick(0, 999_999)) * 10n ** 12n; // $1 to $5000, with cents and below
  const conf = pick(60, 100);
  const minConf = pick(75, 95);
  const prem = pick(0, CAP);
  const spread = pick(-200, 250);
  const stale = rand() < 0.15; // sometimes the Oracle price is over an hour old
  const amount = E(String(pick(1, 1000))) + BigInt(pick(0, 999)) * 10n ** 15n;
  const runs = pick(1, 3);
  const budget = amount * BigInt(runs);
  const start = (await now()) + 30;
  await tx(user, plan, SP.abi, "createPlan", [gld, amount, 86400, start, 86400, prem, minConf, budget, start + 10 * 86400]); // a day-long window, so ageing the price can't close it
  const id = (await read(plan, SP.abi, "planCount")) - 1n;
  await jump(40);
  await tx(owner, oracle, O.abi, "forceSetPrices", [[gld], [price], [conf]]);
  await tx(owner, pool, PL.abi, "setSpread", [gld, BigInt(spread)]);
  if (stale) await jump(3601 + pick(0, 2000)); // the price is now over an hour old

  const userUsd0 = await read(usdg, T.abi, "balanceOf", [user.account.address]);
  const userGld0 = await read(gld, T.abi, "balanceOf", [user.account.address]);
  const res = await tryExec(keeper, plan, id);
  const p = await read(plan, SP.abi, "getPlan", [id]);
  const spent = userUsd0 - (await read(usdg, T.abi, "balanceOf", [user.account.address]));
  const got = (await read(gld, T.abi, "balanceOf", [user.account.address])) - userGld0;
  const tag = `(round ${r}: price ${price}, conf ${conf}/${minConf}, spread ${spread}, prem ${prem}, stale ${stale}, ${res.ok ? "filled" : "refused: " + res.why})`;

  // when should it fill? fresh, confident, and the pool strictly inside the premium (the exact edge may round either way)
  const should = !stale && conf >= minConf && spread < prem;
  const shouldNot = stale || conf < minConf || spread > prem;
  if (should) check("fills when every condition holds", res.ok, tag);
  if (shouldNot) check("refuses when any condition fails", !res.ok, tag);
  if (res.ok) {
    tally.filled++;
    const maxPrice = (price * (BPS + BigInt(prem))) / BPS;
    check("S1 paid per token ≤ fair × (1 + premium)", spent * WAD <= got * maxPrice + got, tag); // + got: one wei of rounding per token unit
    check("S2 one run spends exactly the plan amount", spent === amount, tag);
    check("S2 spent so far ≤ budget", p.spent <= p.budget, tag);
    check("S6 the owner received the tokens", got > 0n, tag);
  } else {
    tally.refused++;
    check("a refused buy moves no money", spent === 0n && got === 0n, tag);
  }
  check("StackPlan holds nothing afterwards", (await read(usdg, T.abi, "balanceOf", [plan])) === 0n && (await read(gld, T.abi, "balanceOf", [plan])) === 0n, tag);
  check("no allowance left with the venue", (await read(usdg, T.abi, "allowance", [plan, pool])) === 0n, tag);
  if (stale) await tx(owner, oracle, O.abi, "forceSetPrices", [[gld], [price], [conf]]);
}
console.log(`random rounds: ${tally.filled} filled, ${tally.refused} refused`);

// ---------------------------------------------------------------- hostile venues
const src = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
interface IT { function transferFrom(address,address,uint256) external returns (bool); function transfer(address,uint256) external returns (bool); }
interface IP { function execute(uint256) external returns (uint256); }
contract LyingVenue { IT loan; constructor(IT l) { loan = l; }
  function buy(address asset, uint256 amountIn, uint256 minOut, address to) external returns (uint256) {
    loan.transferFrom(msg.sender, address(this), amountIn); IT(asset).transfer(to, minOut / 2); return minOut; } }
contract GreedyVenue { IT loan; constructor(IT l) { loan = l; }
  function buy(address asset, uint256 amountIn, uint256 minOut, address to) external returns (uint256) {
    loan.transferFrom(msg.sender, address(this), amountIn * 2); IT(asset).transfer(to, minOut); return minOut; } }
contract ReentrantVenue { IT loan; uint256 public target; constructor(IT l) { loan = l; } function setTarget(uint256 t) external { target = t; }
  function buy(address asset, uint256 amountIn, uint256 minOut, address to) external returns (uint256) {
    loan.transferFrom(msg.sender, address(this), amountIn); IP(msg.sender).execute(target); IT(asset).transfer(to, minOut); return minOut; } }`;
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "Hostile.sol": { content: src } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
if ((out.errors ?? []).some((e) => e.severity === "error")) throw new Error(out.errors.map((e) => e.formattedMessage).join("\n"));
const H = (n) => ({ abi: out.contracts["Hostile.sol"][n].abi, bytecode: `0x${out.contracts["Hostile.sol"][n].evm.bytecode.object}` });

await tx(owner, oracle, O.abi, "forceSetPrices", [[gld], [E("100")], [95]]);
for (const name of ["LyingVenue", "GreedyVenue", "ReentrantVenue"]) {
  const h = H(name);
  const venue = await deploy(h.abi, h.bytecode, [usdg]);
  await tx(owner, gld, T.abi, "mint", [venue, E("1000")]);
  await tx(owner, plan, SP.abi, "setVenue", [venue]);
  const start = (await now()) + 30;
  await tx(user, plan, SP.abi, "createPlan", [gld, E("100"), 3600, start, 3600, 50, 75, E("1000"), start + 86400]);
  const id = (await read(plan, SP.abi, "planCount")) - 1n;
  if (name === "ReentrantVenue") await tx(owner, venue, h.abi, "setTarget", [id]);
  await jump(40);
  await tx(owner, oracle, O.abi, "forceSetPrices", [[gld], [E("100")], [95]]);
  const before = await read(usdg, T.abi, "balanceOf", [user.account.address]);
  const res = await tryExec(keeper, plan, id);
  const lost = before - (await read(usdg, T.abi, "balanceOf", [user.account.address]));
  check(`${name}: the buy is refused`, !res.ok, `(${res.why ?? "it went through"})`);
  check(`${name}: the user loses nothing`, lost === 0n, `(lost ${lost})`);
  console.log(`${name.padEnd(15)} refused with "${res.why}"`);
}
await tx(owner, plan, SP.abi, "setVenue", [pool]);

console.log(`\n${pass} checks passed, ${fail} failed`);
if (failures.length) console.log(failures.slice(0, 10).join("\n"));
process.exit(fail ? 1 : 0);
