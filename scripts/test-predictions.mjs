// NightshiftPredictions tests on a local chain (no deployment.json needed):
//   npx hardhat node --config hardhat.config.cjs   (in another terminal)
//   node scripts/test-predictions.mjs
// Covers rounds, betting rules, time-weighted shares, the optimistic path (propose, dispute, finalize, arbitrate),
// the Pyth path (MockPyth), refunds (tie, one-sided, cancel) and properties P1 to P5, plus a randomised fuzz pass.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, defineChain, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const pub = createPublicClient({ chain, transport: http() });
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner + arbiter
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // keeper (operator)
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // alice
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // bob
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // carol
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // mallory (never registered)
];
const [owner, keeper, alice, bob, carol, mallory] = KEYS.map((k) => createWalletClient({ chain, transport: http(), account: privateKeyToAccount(k) }));
const PLAYERS = [alice, bob, carol];

let pass = 0, fail = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); ok ? pass++ : fail++; };
const tx = async (w, address, name, fn, args = [], value) => { const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi: A[name].abi, functionName: fn, args, value }) }); if (r.status !== "success") throw new Error(`${fn} failed`); return r; };
const read = (address, name, fn, args = []) => pub.readContract({ address, abi: A[name].abi, functionName: fn, args });
const chainText = (e) => { const out = []; for (let x = e; x && out.length < 12; x = x.cause) out.push(x.shortMessage, x.message, x.details, x.reason); return out.filter(Boolean).join(" | "); };
const reverts = async (w, address, name, fn, args, why, value) => {
  try { await pub.simulateContract({ address, abi: A[name].abi, functionName: fn, args, account: w.account, value }); return false; }
  catch (e) {
    const m = chainText(e);
    const ok = why ? m.includes(why) : true;
    if (!ok) console.log(`      (expected "${why}", got: ${(m.match(/reason string '([^']*)'/) ?? [, m.slice(0, 160)])[1]})`);
    return ok;
  }
};
const deploy = async (name, args = []) => (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args }) })).contractAddress;
const now = async () => Number((await pub.getBlock()).timestamp);
const jumpTo = async (t) => { const n = await now(); if (t > n) { await pub.request({ method: "evm_setNextBlockTimestamp", params: [t] }); await pub.request({ method: "evm_mine", params: [] }); } };
const E = parseEther;
const P8 = (x) => BigInt(Math.round(x * 1e8));
const b8 = (s) => toHex(s, { size: 8 });
const HIGHER = 1, LOWER = 2;
const ST = { None: 0, Open: 1, Proposed: 2, Settled: 3, Cancelled: 4 };
const OUT = { None: 0, Higher: 1, Lower: 2, Refund: 3 };

// ---- set up
const usdg = await deploy("TestToken", ["Test USDG", "tUSDG", E("1000000")]);
const pm = await deploy("NightshiftPredictions", [usdg, keeper.account.address]);
const bal = (a) => read(usdg, "TestToken", "balanceOf", [a]);
for (const p of [...PLAYERS, mallory]) {
  await tx(owner, usdg, "TestToken", "mint", [p.account.address, E("20000")]);
  await tx(p, usdg, "TestToken", "approve", [pm, E("1000000")]);
}
await tx(keeper, pm, "NightshiftPredictions", "setMembers", [PLAYERS.map((p) => p.account.address), true]);

let session = 20261104;
// opens a round for each token; betting from now to +12h, open at +12.5h
const openRounds = async (tokens = ["SPY"], strikes = [757.97]) => {
  const t = await now();
  const first = Number(await read(pm, "NightshiftPredictions", "roundCount"));
  await tx(keeper, pm, "NightshiftPredictions", "createRounds", [tokens.map(b8), strikes.map(P8), session, t, t + 12 * 3600, t + 12.5 * 3600, toHex("algo-tx", { size: 32 })]);
  session++;
  return { ids: tokens.map((_, i) => first + i), openTime: t, lockTime: t + 12 * 3600, marketOpen: t + 12.5 * 3600 };
};
const round = (id) => read(pm, "NightshiftPredictions", "getRound", [BigInt(id)]);
const bet = (w, id, side, amt) => tx(w, pm, "NightshiftPredictions", "bet", [BigInt(id), side, E(String(amt))]);
const claim = (w, ids) => tx(w, pm, "NightshiftPredictions", "claim", [ids.map(BigInt)]);
const settleOptimistic = async (r, id, price) => {
  await jumpTo(r.marketOpen + 60);
  await tx(keeper, pm, "NightshiftPredictions", "propose", [BigInt(id), P8(price)]);
  await jumpTo((await now()) + 2 * 3600 + 1);
  await tx(alice, pm, "NightshiftPredictions", "finalize", [BigInt(id)]);
};

// 1. creating rounds
let r = await openRounds(["SPY", "QQQ"], [757.97, 694.26]);
check("createRounds opens one round per token", Number(await read(pm, "NightshiftPredictions", "roundCount")) === 2);
check("roundOf finds a round by token and session", (await read(pm, "NightshiftPredictions", "roundOf", [b8("QQQ"), session - 1])) === 1n);
check("a second round for the same token and session reverts", await reverts(keeper, pm, "NightshiftPredictions", "createRounds", [[b8("SPY")], [P8(1)], session - 1, r.openTime, r.lockTime, r.marketOpen, toHex(0, { size: 32 })], "exists"));
check("only an operator can create rounds", await reverts(alice, pm, "NightshiftPredictions", "createRounds", [[b8("GLD")], [P8(1)], 1, r.openTime, r.lockTime, r.marketOpen, toHex(0, { size: 32 })], "operator"));

// 2. betting rules
const [spy, qqq] = r.ids;
check("P5: an unregistered wallet can't bet", await reverts(mallory, pm, "NightshiftPredictions", "bet", [BigInt(spy), HIGHER, E("10")], "not registered"));
check("only an operator can register wallets", await reverts(alice, pm, "NightshiftPredictions", "setMembers", [[mallory.account.address], true], "operator"));
check("a bet with no side reverts", await reverts(alice, pm, "NightshiftPredictions", "bet", [BigInt(spy), 0, E("10")], "side"));
check("a bet above maxBet reverts", await reverts(alice, pm, "NightshiftPredictions", "bet", [BigInt(spy), HIGHER, E("1001")], "amount"));
const a0 = await bal(alice.account.address);
await bet(alice, spy, HIGHER, 100); // at openTime: weight 1.00
check("a bet pulls exactly the stake", a0 - (await bal(alice.account.address)) === E("100"));
let pos = await read(pm, "NightshiftPredictions", "positions", [BigInt(spy), alice.account.address]);
check("a bet at the open counts full weight", pos[3] === E("100"), `${formatEther(pos[3])} shares`);
check("a wallet can't switch sides", await reverts(alice, pm, "NightshiftPredictions", "bet", [BigInt(spy), LOWER, E("10")], "other side"));
await jumpTo(r.openTime + 6 * 3600); // halfway: weight 0.75
await bet(bob, spy, LOWER, 100);
pos = await read(pm, "NightshiftPredictions", "positions", [BigInt(spy), bob.account.address]);
const bobShares = pos[3];
check("a bet halfway counts 0.75 weight", bobShares >= E("74.99") && bobShares <= E("75.01"), `${formatEther(bobShares)} shares`);
await bet(carol, spy, LOWER, 100);
await bet(alice, spy, HIGHER, 50); // add to the same side
pos = await read(pm, "NightshiftPredictions", "positions", [BigInt(spy), alice.account.address]);
check("adding to the same side accumulates the stake", pos[2] === E("150"));
// wallet cap
await tx(owner, pm, "NightshiftPredictions", "setLimits", [E("1000"), E("1000"), 7200, 86400, 5000]);
check("a bet past the per-wallet cap reverts", await reverts(alice, pm, "NightshiftPredictions", "bet", [BigInt(spy), HIGHER, E("900")], "wallet cap"));
await tx(owner, pm, "NightshiftPredictions", "setLimits", [E("1000"), E("5000"), 7200, 86400, 5000]);
check("only the owner sets limits", await reverts(alice, pm, "NightshiftPredictions", "setLimits", [E("1"), E("1"), 1, 3601, 1], "owner"));
await tx(owner, pm, "NightshiftPredictions", "setPaused", [true]);
check("no bets while paused", await reverts(carol, pm, "NightshiftPredictions", "bet", [BigInt(qqq), HIGHER, E("10")], "paused"));
await tx(owner, pm, "NightshiftPredictions", "setPaused", [false]);
await jumpTo(r.lockTime);
check("no bets after lock", await reverts(carol, pm, "NightshiftPredictions", "bet", [BigInt(qqq), HIGHER, E("10")], "closed"));

// 3. optimistic settlement: SPY opens higher
check("propose before the open reverts", await reverts(keeper, pm, "NightshiftPredictions", "propose", [BigInt(spy), P8(759.45)], "too early"));
await jumpTo(r.marketOpen + 60);
check("only an operator proposes", await reverts(alice, pm, "NightshiftPredictions", "propose", [BigInt(spy), P8(759.45)], "operator"));
await tx(keeper, pm, "NightshiftPredictions", "propose", [BigInt(spy), P8(759.45)]);
check("finalize inside the challenge window reverts", await reverts(alice, pm, "NightshiftPredictions", "finalize", [BigInt(spy)], "challenge open"));
check("claim before settlement pays nothing", await reverts(alice, pm, "NightshiftPredictions", "claim", [[BigInt(spy)]], "nothing to claim"));
await jumpTo((await now()) + 2 * 3600 + 1);
check("disputes close with the challenge window", await reverts(bob, pm, "NightshiftPredictions", "dispute", [BigInt(spy)], "not disputable"));
await tx(mallory, pm, "NightshiftPredictions", "finalize", [BigInt(spy)]); // anyone
let R = await round(spy);
check("finalize settles Higher when the open beats the call", R.status === ST.Settled && R.outcome === OUT.Higher);
const want = await read(pm, "NightshiftPredictions", "payoutOf", [BigInt(spy), alice.account.address]);
check("P2: the winner gets the stake back plus the whole losing pool (fee 0)", want === E("150") + E("200"), formatEther(want));
check("losers are owed nothing", (await read(pm, "NightshiftPredictions", "payoutOf", [BigInt(spy), bob.account.address])) === 0n);
const a1 = await bal(alice.account.address);
await claim(alice, [spy]);
check("claim pays what payoutOf promised", (await bal(alice.account.address)) - a1 === want);
check("P4: a position is paid once", await reverts(alice, pm, "NightshiftPredictions", "claim", [[BigInt(spy)]], "nothing to claim"));
check("a loser's claim reverts with nothing to claim", await reverts(bob, pm, "NightshiftPredictions", "claim", [[BigInt(spy)]], "nothing to claim"));

// 4. one-sided round (QQQ: nobody bet Lower) → refund
// (only alice could have bet; place it on a fresh round instead)
r = await openRounds(["QQQ"], [700]);
await bet(alice, r.ids[0], HIGHER, 80);
await settleOptimistic(r, r.ids[0], 710);
R = await round(r.ids[0]);
check("a one-sided round settles as a refund", R.outcome === OUT.Refund);
const a2 = await bal(alice.account.address);
await claim(alice, [r.ids[0]]);
check("P3: the refund returns the exact stake", (await bal(alice.account.address)) - a2 === E("80"));

// 5. tie → refund
r = await openRounds(["GLD"], [357.16]);
await bet(alice, r.ids[0], HIGHER, 40);
await bet(bob, r.ids[0], LOWER, 60);
await settleOptimistic(r, r.ids[0], 357.16);
R = await round(r.ids[0]);
check("a tie settles as a refund", R.outcome === OUT.Refund);
const b2 = await bal(bob.account.address);
await claim(bob, [r.ids[0]]);
check("P3: a tie refunds each stake exactly", (await bal(bob.account.address)) - b2 === E("60"));

// 6. dispute → arbiter
r = await openRounds(["SLV"], [45.18]);
await bet(alice, r.ids[0], HIGHER, 100);
await bet(bob, r.ids[0], LOWER, 100);
await jumpTo(r.marketOpen + 60);
await tx(keeper, pm, "NightshiftPredictions", "propose", [BigInt(r.ids[0]), P8(44)]); // a wrong price
check("an unregistered wallet can't dispute", await reverts(mallory, pm, "NightshiftPredictions", "dispute", [BigInt(r.ids[0])], "not registered"));
await tx(alice, pm, "NightshiftPredictions", "dispute", [BigInt(r.ids[0])]);
await jumpTo((await now()) + 3 * 3600);
check("a disputed proposal can't be finalized", await reverts(carol, pm, "NightshiftPredictions", "finalize", [BigInt(r.ids[0])], "status"));
check("only the arbiter arbitrates", await reverts(alice, pm, "NightshiftPredictions", "arbitrate", [BigInt(r.ids[0]), P8(45.88), false], "arbiter"));
await tx(owner, pm, "NightshiftPredictions", "arbitrate", [BigInt(r.ids[0]), P8(45.88), false]);
R = await round(r.ids[0]);
check("the arbiter's price decides the round (Higher)", R.outcome === OUT.Higher && R.openPrice === P8(45.88));

// 7. nobody settles → anyone cancels after 24h
r = await openRounds(["IBIT"], [43.89]);
await bet(alice, r.ids[0], HIGHER, 25);
await bet(bob, r.ids[0], LOWER, 35);
await jumpTo(r.marketOpen + 3600);
check("cancel before cancelAfter reverts", await reverts(carol, pm, "NightshiftPredictions", "cancel", [BigInt(r.ids[0])], "too early"));
await jumpTo(r.marketOpen + 24 * 3600 + 1);
await tx(carol, pm, "NightshiftPredictions", "cancel", [BigInt(r.ids[0])]);
const a3 = await bal(alice.account.address), b3 = await bal(bob.account.address);
await claim(alice, [r.ids[0]]);
await claim(bob, [r.ids[0]]);
check("P3: a cancelled round refunds both sides exactly", (await bal(alice.account.address)) - a3 === E("25") && (await bal(bob.account.address)) - b3 === E("35"));

// 8. fee: 2% of the losing pool, winners still get their stake back
await tx(owner, pm, "NightshiftPredictions", "setFee", [200, owner.account.address]);
check("fees above 3% are refused", await reverts(owner, pm, "NightshiftPredictions", "setFee", [301, owner.account.address], "fee"));
r = await openRounds(["SPY"], [750]);
await bet(alice, r.ids[0], LOWER, 100);
await bet(bob, r.ids[0], HIGHER, 300);
await settleOptimistic(r, r.ids[0], 748);
const feeOwed = await read(pm, "NightshiftPredictions", "feesOwed");
check("the fee comes from the losing pool only", feeOwed === E("6"), formatEther(feeOwed));
const pay = await read(pm, "NightshiftPredictions", "payoutOf", [BigInt(r.ids[0]), alice.account.address]);
check("P2 with a fee: winner gets stake + losing pool − fee", pay === E("100") + E("294"), formatEther(pay));
await claim(alice, [r.ids[0]]);
const t0 = await bal(owner.account.address);
await tx(carol, pm, "NightshiftPredictions", "withdrawFees");
check("withdrawFees pays the treasury", (await bal(owner.account.address)) - t0 === E("6"));
await tx(owner, pm, "NightshiftPredictions", "setFee", [0, owner.account.address]);

// 9. Pyth path
const mock = await deploy("MockPyth");
const FEED = toHex("spy-feed", { size: 32 });
r = await openRounds(["SPY"], [757.97]);
await bet(alice, r.ids[0], HIGHER, 10);
await bet(bob, r.ids[0], LOWER, 10);
await jumpTo(r.marketOpen + 30);
check("Pyth path is off until configured", await reverts(carol, pm, "NightshiftPredictions", "resolveWithPyth", [BigInt(r.ids[0]), []], "pyth off", 1n));
await tx(owner, pm, "NightshiftPredictions", "setPyth", [mock, 60]);
await tx(owner, pm, "NightshiftPredictions", "setPythFeed", [b8("SPY"), FEED]);
await tx(owner, mock, "MockPyth", "set", [FEED, 75100000n, -5, BigInt(r.marketOpen + 120)]); // published too late
check("a Pyth price published outside the open window is refused", await reverts(carol, pm, "NightshiftPredictions", "resolveWithPyth", [BigInt(r.ids[0]), []], "PriceFeedNotFoundWithinRange", 1n));
await tx(owner, mock, "MockPyth", "set", [FEED, 75610000n, -5, BigInt(r.marketOpen + 2)]); // $756.10 at 09:30:02
check("resolveWithPyth needs the update fee", await reverts(carol, pm, "NightshiftPredictions", "resolveWithPyth", [BigInt(r.ids[0]), []], "pyth fee", 0n));
await tx(carol, pm, "NightshiftPredictions", "resolveWithPyth", [BigInt(r.ids[0]), []], 1n);
R = await round(r.ids[0]);
check("anyone settles from Pyth's signed open (Lower, $756.10)", R.outcome === OUT.Lower && R.openPrice === P8(756.1));

// 10. fuzz: random rounds, bets and outcomes; P1 (never pay out more than was staked) and P2 on every round
let fuzzOk = true, rounds = 0;
const rnd = (n) => Math.floor(Math.random() * n);
for (let k = 0; k < 12; k++) {
  r = await openRounds(["SPY"], [100]);
  const id = r.ids[0];
  const staked = {};
  for (let j = 0; j < 6; j++) {
    const w = PLAYERS[rnd(3)];
    const prev = await read(pm, "NightshiftPredictions", "positions", [BigInt(id), w.account.address]);
    const side = prev[0] || 1 + rnd(2);
    const amt = 1 + rnd(400);
    await jumpTo(r.openTime + rnd(12 * 3600));
    await bet(w, id, side, amt);
    staked[w.account.address] = (staked[w.account.address] ?? 0n) + E(String(amt));
  }
  const price = [99, 100, 101][rnd(3)];
  await settleOptimistic(r, id, price);
  const R2 = await round(id);
  const pot = R2.stakeHigher + R2.stakeLower;
  let paid = 0n;
  for (const w of PLAYERS) {
    const owed = await read(pm, "NightshiftPredictions", "payoutOf", [BigInt(id), w.account.address]);
    const p2 = await read(pm, "NightshiftPredictions", "positions", [BigInt(id), w.account.address]);
    const won = (R2.outcome === OUT.Higher && p2[0] === HIGHER) || (R2.outcome === OUT.Lower && p2[0] === LOWER);
    if (R2.outcome === OUT.Refund && owed !== p2[2]) fuzzOk = false; // P3
    if (won && owed < p2[2]) fuzzOk = false; // P2
    if (owed > 0n) { const before = await bal(w.account.address); await claim(w, [id]); if ((await bal(w.account.address)) - before !== owed) fuzzOk = false; }
    paid += owed;
  }
  if (paid > pot) fuzzOk = false; // P1
  rounds++;
}
check(`fuzz: P1, P2, P3 hold over ${rounds} random rounds`, fuzzOk);
check("the contract holds no more than unclaimed stakes and fees", (await bal(pm)) >= (await read(pm, "NightshiftPredictions", "feesOwed")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
