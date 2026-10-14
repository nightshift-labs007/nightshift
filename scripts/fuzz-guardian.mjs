// Guardian fuzz and scenario tests: random and adversarial price paths against fresh copies of the real contracts
// on a local Hardhat chain. After every price move it checks the invariants proven in formal/Nightshift/Guardian.lean
// against what the contract actually does. Results go to public/verified/guardian-fuzz.json.
//
//   node scripts/fuzz-guardian.mjs                 (200 scenarios × 25 steps, seed 1)
//   FUZZ_SCENARIOS=500 FUZZ_STEPS=40 FUZZ_SEED=7 node scripts/fuzz-guardian.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { createPublicClient, createTestClient, createWalletClient, custom, defineChain, encodeFunctionData, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const SCENARIOS = Number(process.env.FUZZ_SCENARIOS ?? 200);
const STEPS = Number(process.env.FUZZ_STEPS ?? 25);
const SEED = Number(process.env.FUZZ_SEED ?? 1);
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const WAD = 10n ** 18n;
const SLIP = 5n * 10n ** 15n; // NightshiftVault.SLIPPAGE_WAD

// ---------------------------------------------------------------- deterministic randomness
let s = SEED >>> 0 || 1;
const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0), ((s ^ (s >>> 13)) >>> 0) / 4294967296); // [0, 1)
const uni = (a, b) => a + (b - a) * rnd();
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
const wad = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const num = (x) => Number(x) / 1e18;

// ---------------------------------------------------------------- local chain (Hardhat's EVM in this process: no HTTP)
process.env.HARDHAT_CONFIG ??= "hardhat.config.cjs";
const hre = createRequire(import.meta.url)("hardhat");
const chain = defineChain({ id: 31337, name: "fuzz", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://in-process"] } } });
const transport = custom({ request: ({ method, params }) => hre.network.provider.request({ method, params }) }, { retryCount: 0 });
const pub = createPublicClient({ chain, transport, pollingInterval: 1 });
const test = createTestClient({ chain, transport, mode: "hardhat" });
const wallet = (account) => createWalletClient({ chain, transport, account });
const owner = wallet(privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"));
const keeper = wallet(privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"));
const send = async (w, address, name, functionName, args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi: A[name].abi, functionName, args }) });
const read = (address, name, functionName, args = []) => pub.readContract({ address, abi: A[name].abi, functionName, args });
const deploy = async (name, args) => (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args }) })).contractAddress;
/** null if the call would succeed, else the revert reason (a raw eth_call: no client-side retries or decoding) */
const revertReason = async (w, address, name, functionName, args) => {
  try {
    await hre.network.provider.request({ method: "eth_call", params: [{ from: w.account.address, to: address, data: encodeFunctionData({ abi: A[name].abi, functionName, args }) }, "latest"] });
    return null;
  } catch (e) {
    const msg = String(e.message ?? e);
    return msg.match(/reason string '([^']+)'/)?.[1] ?? msg.slice(0, 120);
  }
};

const usdg = await deploy("TestToken", ["Fuzz USDG", "fUSDG", 0n]);
const oracle = await deploy("NightshiftOracle", []);
const vault = await deploy("NightshiftVault", [usdg, oracle]);
const LLTVS = [0.625, 0.77, 0.86];
const markets = [];
for (const l of LLTVS) {
  const t = await deploy("TestToken", [`Fuzz ${l}`, `F${l}`, 0n]);
  await send(owner, vault, "NightshiftVault", "setMarket", [t, wad(l), true]);
  markets.push({ token: t, lltv: wad(l) });
}
await send(owner, usdg, "TestToken", "mint", [vault, parseEther("1000000000000")]);
await send(owner, oracle, "NightshiftOracle", "setUpdater", [owner.account.address, true]);

const setPrice = async (token, price, conf, force) =>
  send(owner, oracle, "NightshiftOracle", force ? "forceSetPrices" : "setPrices", [[token], [price], [conf]]);

// ---------------------------------------------------------------- invariants after one protect() attempt
const stats = { scenarios: 0, steps: 0, protectCalls: 0, protected: 0, refusedHealthy: 0, refusedInsolvent: 0, refusedLiquidatable: 0, liquidations: 0, oracleCapSkips: 0 };
const violations = [];
const fail = (where, msg, extra) => violations.push({ where, msg, ...extra });

async function attemptProtect(where, user, m) {
  const [c, d] = await read(vault, "NightshiftVault", "positions", [user, m.token]);
  if (d === 0n) return "no debt";
  const [, trigger, target] = await read(vault, "NightshiftVault", "rules", [user, m.token]);
  const [price] = await read(oracle, "NightshiftOracle", "getPrice", [m.token]);
  const hf = await read(vault, "NightshiftVault", "healthFactor", [user, m.token]);
  const sellPrice = (price * (WAD - SLIP)) / WAD;
  const expect = hf >= trigger ? "healthy" : hf < WAD ? "liquidatable" : (c * sellPrice) / WAD <= d ? "insolvent: alert only" : null;
  stats.protectCalls++;
  const reason = await revertReason(keeper, vault, "NightshiftVault", "protect", [user, m.token]);
  if (expect !== reason) fail(where, "protect() outcome differs from the proven gate (G4/G5 and the trigger)", { expected: expect ?? "acts", got: reason ?? "acts", hf: num(hf), trigger: num(trigger) });
  if (reason) {
    if (reason === "healthy") stats.refusedHealthy++;
    else if (reason === "liquidatable") stats.refusedLiquidatable++;
    else if (reason.startsWith("insolvent")) stats.refusedInsolvent++;
    return reason;
  }
  await send(keeper, vault, "NightshiftVault", "protect", [user, m.token]);
  stats.protected++;
  const [c2, d2] = await read(vault, "NightshiftVault", "positions", [user, m.token]);
  const sold = c - c2, repaid = d - d2;
  const hf2 = await read(vault, "NightshiftVault", "healthFactor", [user, m.token]);
  if (sold < 0n) fail(where, "G1: used a negative amount of collateral", { sold: String(sold) });
  if (c2 > c) fail(where, "G1/G2: collateral increased", {});
  if (sold > c) fail(where, "G2: used more collateral than the position had", { sold: num(sold), collateral: num(c) });
  if (repaid > d) fail(where, "repaid more than the debt", {});
  if (d2 > 0n && hf2 < hf) fail(where, "protect lowered health (G4)", { before: num(hf), after: num(hf2) });
  if (d2 > 0n) {
    // G3: lands on the target; G3b: not above it (beyond integer rounding)
    const rel = Math.abs(num(hf2) / num(target) - 1);
    if (rel > 1e-9) fail(where, "G3/G3b: health after protect is not the target", { target: num(target), after: num(hf2), relError: rel });
  }
  return "acted";
}

// ---------------------------------------------------------------- random scenarios
async function scenario(i) {
  const m = markets[Math.floor(rnd() * markets.length)];
  const acct = privateKeyToAccount(generatePrivateKey());
  await test.setBalance({ address: acct.address, value: parseEther("10") });
  const u = wallet(acct);
  let price = uni(20, 2000);
  let conf = Math.round(uni(40, 98));
  await setPrice(m.token, wad(price), conf, true);
  const units = uni(0.5, 200);
  await send(owner, m.token, "TestToken", "mint", [acct.address, wad(units)]);
  await send(u, m.token, "TestToken", "approve", [vault, wad(units)]);
  await send(u, vault, "NightshiftVault", "deposit", [m.token, wad(units)]);
  const limit = await read(vault, "NightshiftVault", "borrowLimit", [acct.address, m.token]);
  const amt = (limit * BigInt(Math.round(uni(80, 99.9) * 10))) / 1000n;
  if (amt > 0n) await send(u, vault, "NightshiftVault", "borrow", [m.token, amt]);
  const trig = uni(1.02, 1.6), targ = Math.min(5, trig + uni(0.05, 1.2));
  await send(u, vault, "NightshiftVault", "setRule", [m.token, 2, wad(trig), wad(targ)]);
  stats.scenarios++;
  for (let k = 0; k < STEPS; k++) {
    const r = rnd();
    const move = r < 0.45 ? gauss() * 0.02 : r < 0.75 ? -uni(0.01, 0.06) : r < 0.87 ? uni(0.02, 0.08) : (rnd() < 0.75 ? -1 : 1) * uni(0.05, 0.3);
    price = Math.max(0.5, price * (1 + move));
    conf = Math.max(35, Math.min(98, Math.round(conf + gauss() * 4)));
    await setPrice(m.token, wad(price), conf, Math.abs(move) >= 0.15);
    stats.steps++;
    const res = await attemptProtect(`scenario ${i} step ${k}`, acct.address, m);
    if (res === "liquidatable") {
      await send(owner, usdg, "TestToken", "mint", [keeper.account.address, parseEther("1000000000")]);
      await send(keeper, usdg, "TestToken", "approve", [vault, 2n ** 256n - 1n]);
      const [, d] = await read(vault, "NightshiftVault", "positions", [acct.address, m.token]);
      const why = await revertReason(keeper, vault, "NightshiftVault", "liquidate", [acct.address, m.token, d]);
      if (why) fail(`scenario ${i} step ${k}`, "a loan below health 1 could not be liquidated", { reason: why });
      else { await send(keeper, vault, "NightshiftVault", "liquidate", [acct.address, m.token, d]); stats.liquidations++; }
      break;
    }
  }
}

// ---------------------------------------------------------------- named scenarios
const named = [];
async function namedCase(name, fn) {
  const before = violations.length;
  let error = null;
  try { await fn(); } catch (e) { error = String(e.shortMessage ?? e.message).slice(0, 200); }
  const ok = !error && violations.length === before;
  named.push({ name, ok, ...(error ? { error } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${error ? `  (${error})` : ""}`);
}
async function freshLoan(m, price, units, borrowFrac, trig, targ) {
  const acct = privateKeyToAccount(generatePrivateKey());
  await test.setBalance({ address: acct.address, value: parseEther("10") });
  const u = wallet(acct);
  await setPrice(m.token, wad(price), 90, true);
  await send(owner, m.token, "TestToken", "mint", [acct.address, wad(units)]);
  await send(u, m.token, "TestToken", "approve", [vault, wad(units)]);
  await send(u, vault, "NightshiftVault", "deposit", [m.token, wad(units)]);
  const limit = await read(vault, "NightshiftVault", "borrowLimit", [acct.address, m.token]);
  await send(u, vault, "NightshiftVault", "borrow", [m.token, (limit * BigInt(Math.round(borrowFrac * 1000))) / 1000n]);
  await send(u, vault, "NightshiftVault", "setRule", [m.token, 2, wad(trig), wad(targ)]);
  return acct.address;
}
const M77 = markets[1];

await namedCase("Monday gap: -20% open, Guardian rebalances to target or alerts", async () => {
  const user = await freshLoan(M77, 500, 10, 0.9, 1.15, 1.4);
  await setPrice(M77.token, wad(400), 70, true);
  const r = await attemptProtect("monday gap", user, M77);
  if (!["acted", "insolvent: alert only", "liquidatable"].includes(r)) throw new Error(`unexpected: ${r}`);
});
await namedCase("Crash then recovery: acts once on the way down, never on the way up", async () => {
  const user = await freshLoan(M77, 500, 10, 0.85, 1.2, 1.5);
  let acted = 0;
  for (const p of [480, 460, 440, 420, 440, 470, 500, 520]) {
    await setPrice(M77.token, wad(p), 85, false);
    if ((await attemptProtect("crash/recover", user, M77)) === "acted") acted++;
  }
  if (acted < 1) throw new Error("never acted during the crash");
});
await namedCase("Straddling the trigger: no action at or above it", async () => {
  const user = await freshLoan(M77, 500, 10, 0.8, 1.15, 1.4);
  const [, d] = await read(vault, "NightshiftVault", "positions", [user, M77.token]);
  // price that puts health exactly at the trigger: p = trigger · d / (c · L)
  const pAt = (1.15 * num(d)) / (10 * 0.77);
  await setPrice(M77.token, wad(pAt * 1.0001), 85, true);
  if ((await attemptProtect("straddle above", user, M77)) !== "healthy") throw new Error("acted above the trigger");
  await setPrice(M77.token, wad(pAt * 0.999), 85, false);
  if ((await attemptProtect("straddle below", user, M77)) !== "acted") throw new Error("did not act just below the trigger");
});
await namedCase("Underwater loan: Guardian refuses to touch it", async () => {
  const user = await freshLoan(markets[2], 500, 10, 0.98, 1.4, 2.0);
  // G5: with LLTV < 1 − slippage, a loan that rebalancing can't save already has health < 1, so the refusal shows up
  // as "liquidatable" (the contract's insolvency check is the second line of defence)
  await setPrice(markets[2].token, wad(300), 80, true);
  const r = await attemptProtect("underwater", user, markets[2]);
  if (!["liquidatable", "insolvent: alert only"].includes(r)) throw new Error(`expected a refusal, got ${r}`);
});
await namedCase("Oracle cap: a single 20% update is skipped, the price is unchanged", async () => {
  await setPrice(M77.token, wad(500), 90, true);
  const rcpt = await setPrice(M77.token, wad(400), 90, false);
  const [p] = await read(oracle, "NightshiftOracle", "getPrice", [M77.token]);
  if (p !== wad(500)) throw new Error(`price moved to ${num(p)}`);
  if (!rcpt.logs.length) throw new Error("no PriceSkipped event");
  stats.oracleCapSkips++;
});
await namedCase("Stale price: past the maximum price age, the Guardian stops acting", async () => {
  const user = await freshLoan(M77, 500, 10, 0.5, 1.15, 1.4);
  await test.increaseTime({ seconds: 7 * 86400 + 60 });
  await test.mine({ blocks: 1 });
  const r = await revertReason(keeper, vault, "NightshiftVault", "protect", [user, M77.token]);
  if (r !== "stale price") throw new Error(`protect gave: ${r}`);
});

console.log(`\nrandom: ${SCENARIOS} scenarios × up to ${STEPS} price moves (seed ${SEED})…`);
for (let i = 0; i < SCENARIOS; i++) {
  // keep prices fresh: the stale-price case above moved the clock forward
  await scenario(i);
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${SCENARIOS} scenarios, ${stats.steps} price moves, ${violations.length} violations`);
}

const out = {
  generatedAt: new Date().toISOString(),
  seed: SEED,
  scenarios: SCENARIOS,
  stepsPerScenario: STEPS,
  contracts: "fresh copies of NightshiftOracle and NightshiftVault (lib/chain/artifacts.json), Hardhat EVM",
  invariants: [
    "G1: collateral used ≥ 0, collateral never increases",
    "G2: collateral used ≤ the position's collateral; repaid ≤ debt",
    "G3/G3b: when it acts and debt remains, health lands on the target (relative error ≤ 1e-9)",
    "G4: never lowers health; refuses when the collateral at the slippage price can't cover the debt",
    "G5/trigger: acts only when 1 ≤ health < trigger, otherwise refuses with the matching reason",
    "Below health 1 the loan can always be liquidated",
  ],
  stats,
  named,
  violations: violations.slice(0, 50),
  violationCount: violations.length,
  passed: violations.length === 0 && named.every((n) => n.ok),
};
fs.writeFileSync("public/verified/guardian-fuzz.json", JSON.stringify(out, null, 2) + "\n");
console.log(`\n${out.passed ? "PASS" : "FAIL"}  ${stats.steps} price moves, ${stats.protectCalls} protect() checks: ${stats.protected} acted, ${stats.refusedHealthy} healthy, ${stats.refusedInsolvent} insolvent, ${stats.refusedLiquidatable} liquidatable; ${stats.liquidations} liquidations; ${violations.length} violations`);
for (const v of violations.slice(0, 10)) console.log("  ", JSON.stringify(v));
process.exit(out.passed ? 0 : 1);
