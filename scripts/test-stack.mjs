// StackPlan + StackDemoPool tests on a local chain (no deployment.json needed):
//   npx hardhat node --config hardhat.config.cjs   (in another terminal)
//   node scripts/test-stack.mjs
// Covers the guard (S1 price bound, S4 stale or low-confidence Oracle), spend (S2), cancel (S5), allowlist and
// delivery (S6), plus windows, skipping and who is allowed to do what.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const pub = createPublicClient({ chain, transport: http() });
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // user
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // keeper (anyone)
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // attacker
];
const [owner, user, keeper, attacker] = KEYS.map((k) => createWalletClient({ chain, transport: http(), account: privateKeyToAccount(k) }));

let pass = 0, fail = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); ok ? pass++ : fail++; };
const tx = async (w, address, name, fn, args = []) => { const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi: A[name].abi, functionName: fn, args }) }); if (r.status !== "success") throw new Error(`${fn} failed`); return r; };
const read = (address, name, fn, args = []) => pub.readContract({ address, abi: A[name].abi, functionName: fn, args });
const chainText = (e) => { const out = []; for (let x = e; x && out.length < 12; x = x.cause) out.push(x.shortMessage, x.message, x.details, x.reason); return out.filter(Boolean).join(" | "); };
// true if the call reverts (and, when `why` is given, the revert text contains it)
const reverts = async (w, address, name, fn, args, why) => {
  try { await pub.simulateContract({ address, abi: A[name].abi, functionName: fn, args, account: w.account }); return false; }
  catch (e) {
    const m = chainText(e);
    const ok = why ? m.includes(why) : true;
    if (!ok) console.log(`      (expected "${why}", got: ${(m.match(/reason string '([^']*)'/) ?? [, m.slice(0, 120)])[1]})`);
    return ok;
  }
};
const deploy = async (name, args = []) => (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args }) })).contractAddress;
const now = async () => Number((await pub.getBlock()).timestamp);
const jump = async (s) => { await pub.request({ method: "evm_increaseTime", params: [s] }); await pub.request({ method: "evm_mine", params: [] }); };
const E = parseEther;
const bal = (t, a) => read(t, "TestToken", "balanceOf", [a]);

// ---- set up: loan token, an ETF token, Oracle, demo pool, StackPlan
const usdg = await deploy("TestToken", ["Demo USDG", "dUSDG", E("1000")]);
const gld = await deploy("TestToken", ["Demo GLD", "dGLD", E("20")]);
const oracle = await deploy("NightshiftOracle");
const pool = await deploy("StackDemoPool", [usdg, oracle]);
const stack = await deploy("StackPlan", [usdg, oracle, pool]);
const push = (price, conf = 95) => tx(owner, oracle, "NightshiftOracle", "setPrices", [[gld], [E(String(price))], [conf]]);
const P = (n) => tx(owner, pool, "StackDemoPool", "setSpread", [gld, BigInt(n)]);
await push(360);
await tx(owner, gld, "TestToken", "mint", [pool, E("1000")]); // pool inventory
await tx(owner, usdg, "TestToken", "mint", [user.account.address, E("5000")]);
await tx(owner, stack, "StackPlan", "setAsset", [gld, true, 50]); // allowlist GLD, premium cap 0.5%
await tx(user, usdg, "TestToken", "approve", [stack, E("5000")]);

const WEEK = 7 * 86400;
const make = async (over = {}) => {
  const a = { asset: gld, amount: E("100"), interval: WEEK, start: (await now()) + 60, window: 48 * 3600, prem: 50, conf: 75, budget: E("1000"), expiry: (await now()) + 365 * 86400, ...over };
  const args = [a.asset, a.amount, a.interval, a.start, a.window, a.prem, a.conf, a.budget, a.expiry];
  const r = await tx(user, stack, "StackPlan", "createPlan", args);
  return Number(await read(stack, "StackPlan", "planCount")) - 1;
};
const open = async (id) => { const p = await read(stack, "StackPlan", "getPlan", [id]); const t = await now(); if (t < Number(p.nextRun)) await jump(Number(p.nextRun) - t + 1); await push(360); };

// 1. the happy path
let id = await make();
check("create stores the plan and lists it for its owner", (await read(stack, "StackPlan", "plansOf", [user.account.address])).includes(BigInt(id)));
check("execute before the window opens reverts", await reverts(keeper, stack, "StackPlan", "execute", [id], "too early"));
await open(id);
await P(0);
const usdBefore = await bal(usdg, user.account.address), gldBefore = await bal(gld, user.account.address), keeperGld = await bal(gld, keeper.account.address);
await tx(keeper, stack, "StackPlan", "execute", [id]); // anyone may run it
const got = (await bal(gld, user.account.address)) - gldBefore;
check("an installment pulls exactly the plan amount from the owner", usdBefore - (await bal(usdg, user.account.address)) === E("100"));
check("S6: the asset lands with the plan owner, none with the caller", got > 0n && (await bal(gld, keeper.account.address)) === keeperGld, `${formatEther(got)} GLD`);
check("fill at fair value: 100 USDG buys 100/360 GLD", got === (E("100") * E("1")) / E("360"));
check("StackPlan keeps no balance after a run", (await bal(usdg, stack)) === 0n && (await bal(gld, stack)) === 0n);
check("the pool's allowance is reset to zero", (await read(usdg, "TestToken", "allowance", [stack, pool])) === 0n);
let p = await read(stack, "StackPlan", "getPlan", [id]);
check("the run is counted and the next window moves out by one interval", p.runs === 1 && p.spent === E("100"));
check("a second execute in the same window reverts (too early)", await reverts(keeper, stack, "StackPlan", "execute", [id], "too early"));

// 2. S1 price bound
await jump(WEEK); await push(360);
await P(100); // the pool now charges +1.00%, plan allows 0.50%
check("S1: a pool price above fair value + max premium is refused", await reverts(keeper, stack, "StackPlan", "execute", [id], "slippage"));
await P(51);
check("S1: still refused at +0.51%", await reverts(keeper, stack, "StackPlan", "execute", [id]));
await P(49); // the bound is strict (rounded against the buyer), so the exact +0.50% edge itself can miss by a wei
const before2 = await bal(gld, user.account.address);
await tx(keeper, stack, "StackPlan", "execute", [id]);
const out2 = (await bal(gld, user.account.address)) - before2;
const paid2 = Number(formatEther((E("100") * E("1")) / out2)); // USD per token actually paid
check("S1: at +0.49% it fills, and never costs more than fair value × 1.005", paid2 <= 360 * 1.005 + 1e-9 && paid2 > 360, `paid ${paid2.toFixed(4)} vs fair 360`);

// 3. S4 guard: stale Oracle, low confidence
await jump(WEEK); // window opens, but the Oracle price is a week old
check("S4: a stale Oracle price blocks the buy", await reverts(keeper, stack, "StackPlan", "execute", [id], "stale price"));
await push(360, 70);
check("S4: confidence below the plan's floor (70 < 75) blocks the buy", await reverts(keeper, stack, "StackPlan", "execute", [id], "low confidence"));
await push(360, 80);
await P(0);
await tx(keeper, stack, "StackPlan", "execute", [id]);
check("S4: with a fresh price and confidence 80 the buy goes through", (await read(stack, "StackPlan", "getPlan", [id])).runs === 3);

// 4. windows and skipping
await jump(WEEK + 49 * 3600); await push(360);
check("a window that has closed can't be executed late", await reverts(keeper, stack, "StackPlan", "execute", [id], "window closed"));
check("skip() is refused while a window is still open", await reverts(keeper, stack, "StackPlan", "skip", [(await make({ start: (await now()) + 5 }))], "window open"));
await tx(attacker, stack, "StackPlan", "skip", [id]); // anyone may roll a missed plan
p = await read(stack, "StackPlan", "getPlan", [id]);
check("skip() rolls the plan to the next slot without spending", p.runs === 3 && p.spent === E("300") && Number(p.nextRun) > (await now()) - 48 * 3600);
await open(id);
await P(0);
await tx(keeper, stack, "StackPlan", "execute", [id]);
check("after a skip the plan fills in its new window", (await read(stack, "StackPlan", "getPlan", [id])).runs === 4);

// 5. S2 spend bound
const small = await make({ budget: E("200") });
await open(small); await P(0);
await tx(keeper, stack, "StackPlan", "execute", [small]);
await jump(WEEK); await push(360);
await tx(keeper, stack, "StackPlan", "execute", [small]);
await jump(WEEK); await push(360);
check("S2: a plan can never spend beyond its budget (third run reverts)", await reverts(keeper, stack, "StackPlan", "execute", [small], "budget"));
check("S2: a plan can't be created over the per-run cap", await reverts(user, stack, "StackPlan", "createPlan", [gld, E("1001"), WEEK, (await now()) + 60, 3600, 50, 75, E("5000"), (await now()) + 99999]));
check("S2: the owner's allowance is also a hard limit (revoked approval stops the run)", await (async () => {
  const q = await make(); await tx(user, usdg, "TestToken", "approve", [stack, 0n]); await open(q);
  const r = await reverts(keeper, stack, "StackPlan", "execute", [q]);
  await tx(user, usdg, "TestToken", "approve", [stack, E("5000")]);
  return r;
})());
const old = await make({ expiry: (await now()) + 3 * 86400 }); await open(old); await jump(4 * 86400); await push(360);
check("a plan past its expiry can't run", await reverts(keeper, stack, "StackPlan", "execute", [old]));

// 6. pause, resume, cancel (S5)
const c = await make(); await open(c);
check("only the plan's owner can pause it", await reverts(attacker, stack, "StackPlan", "pause", [c], "not your plan"));
await tx(user, stack, "StackPlan", "pause", [c]);
check("a paused plan doesn't run", await reverts(keeper, stack, "StackPlan", "execute", [c], "not active"));
await tx(user, stack, "StackPlan", "resume", [c]); await P(0); await push(360);
check("resume brings it back", !(await reverts(keeper, stack, "StackPlan", "execute", [c])));
await tx(user, stack, "StackPlan", "cancel", [c]);
await jump(WEEK); await push(360);
check("S5: after cancel no call can run the plan", await reverts(keeper, stack, "StackPlan", "execute", [c], "not active"));
check("S5: a cancelled plan can't be resumed", await reverts(user, stack, "StackPlan", "resume", [c], "status"));

// 7. allowlist and limits on creation (S6, S2)
const fake = await deploy("TestToken", ["Look-alike SLV", "SLV", E("1")]);
check("S6: a token that isn't on the allowlist is refused", await reverts(user, stack, "StackPlan", "createPlan", [fake, E("10"), WEEK, (await now()) + 60, 3600, 50, 75, E("100"), (await now()) + 99999], "asset"));
const base = [gld, E("10"), WEEK, (await now()) + 60, 3600, 50, 75, E("100"), (await now()) + 99999];
const bad = (i, v) => { const a = [...base]; a[i] = v; return a; };
check("the interval can't be below the minimum", await reverts(user, stack, "StackPlan", "createPlan", bad(2, 600)));
check("the premium can't exceed the asset's cap", await reverts(user, stack, "StackPlan", "createPlan", bad(5, 51)));
check("the confidence floor can't be weakened below 75", await reverts(user, stack, "StackPlan", "createPlan", bad(6, 60)));
check("the window can't be longer than the interval", await reverts(user, stack, "StackPlan", "createPlan", bad(4, WEEK + 1)));

// 8. admin is owner-only
check("only the owner can list assets", await reverts(attacker, stack, "StackPlan", "setAsset", [fake, true, 50], "owner"));
check("only the owner can change the venue", await reverts(attacker, stack, "StackPlan", "setVenue", [attacker.account.address], "owner"));
check("only the owner can set pool spreads", await reverts(attacker, pool, "StackDemoPool", "setSpread", [gld, 500n], "owner"));
check("the premium cap on an asset can't be set above 5%", await reverts(owner, stack, "StackPlan", "setAsset", [fake, true, 501], "premium cap"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
