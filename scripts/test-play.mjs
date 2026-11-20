// End-to-end test of the points game against a running dev server (not production: it uses the test clock header).
//   npm run dev   (in another terminal)
//   node scripts/test-play.mjs [http://localhost:3000]
// Checks validation, the lock boundary, crowd counts, changing a pick, streaks, and real settlement of a past round
// from Yahoo prices. Settlement needs Yahoo to answer; if it is rate-limited the script says so instead of failing.
const BASE = process.argv[2] ?? "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (cond, msg) => (cond ? (pass++, console.log("  ok  ", msg)) : (fail++, console.log("  FAIL", msg)));

async function call(path, { method = "GET", body, cookie, now } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (now) headers["x-play-now"] = now;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const set = res.headers.get("set-cookie");
  return { status: res.status, json: await res.json().catch(() => null), cookie: set ? set.split(";")[0] : null };
}
const pick = (date, ticker, side, opts) => call("/api/play/pick", { method: "POST", body: { date, ticker, side }, ...opts });

try {
console.log("validation");
{
  const s = (await call("/api/play")).json;
  ok(s && s.round && s.assets.length === 5, "GET /api/play returns the current round and 5 assets");
  ok(s.stats === null && Object.keys(s.myPicks).length === 0, "no cookie: no picks, no stats");
  ok((await pick(s.round.date, "MSFT", "up")).status === 400, "unknown asset is refused");
  ok((await pick(s.round.date, "NVDA", "sideways")).status === 400, "bad side is refused");
  ok((await pick("2001-01-01", "NVDA", "up")).status === 409, "a pick for a round that isn't open is refused");
}

console.log("lock boundary (test clock: Thu 19 Nov 2026, close 21:00Z)");
{
  const before = await pick("2026-11-19", "NVDA", "up", { now: "2026-11-19T20:59:59.000Z" });
  ok(before.status === 200 && before.cookie, "1 s before the close: accepted, cookie set");
  const at = await pick("2026-11-19", "NVDA", "down", { now: "2026-11-19T21:00:00.000Z", cookie: before.cookie });
  ok(at.status === 409 && at.json?.round === "2026-11-20", "at the close: refused, next round is 20 Nov");
  const s = (await call("/api/play", { cookie: before.cookie, now: "2026-11-19T20:59:59.000Z" })).json;
  ok(s.myPicks.NVDA === "up", "the refused change did not overwrite the pick");
}

console.log("crowd counts and changing a pick (blind: you see the split only for assets you picked)");
{
  const now = "2026-11-18T15:00:00.000Z"; // Wed 18 Nov, round 2026-11-18
  const a = await pick("2026-11-18", "AAPL", "up", { now });
  const b = await pick("2026-11-18", "AAPL", "up", { now });
  const s1 = (await call("/api/play", { cookie: a.cookie, now })).json;
  ok(s1.crowd.AAPL && s1.crowd.AAPL.up >= 2, "two players up on AAPL");
  ok(s1.crowd.TSLA === undefined, "no crowd shown for an asset you haven't picked");
  const upBefore = s1.crowd.AAPL.up, downBefore = s1.crowd.AAPL.down;
  const s2 = (await pick("2026-11-18", "AAPL", "down", { now, cookie: b.cookie })).json;
  ok(s2.crowd.AAPL.up === upBefore - 1 && s2.crowd.AAPL.down === downBefore + 1, "changing a pick moves one count, no double counting");
}

console.log("streaks and settlement from real prices");
{
  // one player picks on Tue 17, Wed 18 and Thu 19 Nov, then looks on Fri 20 Nov after the open
  const p1 = await pick("2026-11-17", "SPY", "up", { now: "2026-11-17T15:00:00.000Z" });
  const c = p1.cookie;
  await pick("2026-11-18", "SPY", "down", { now: "2026-11-18T15:00:00.000Z", cookie: c });
  await pick("2026-11-19", "SPY", "up", { now: "2026-11-19T15:00:00.000Z", cookie: c });
  await pick("2026-11-19", "GLD", "down", { now: "2026-11-19T15:00:00.000Z", cookie: c });
  const before = (await call("/api/play", { cookie: c, now: "2026-11-19T15:30:00.000Z" })).json;
  ok(before.stats.streak === 3, `streak is 3 after three rounds in a row (got ${before.stats?.streak})`);

  let s = null;
  for (let i = 0; i < 4; i++) {
    s = (await call("/api/play", { cookie: c, now: "2026-11-20T16:00:00.000Z" })).json; // Fri 11:00 ET
    if (s.history.find((h) => h.date === "2026-11-19")?.status === "settled") break;
    await new Promise((r) => setTimeout(r, 95_000)); // the settle lock is 90 s
  }
  const thu = s.history.find((h) => h.date === "2026-11-19");
  if (thu?.status !== "settled") {
    console.log(`  SKIP settlement: round 2026-11-19 is still "${thu?.status}" (Yahoo unavailable or rate-limited)`);
  } else {
    for (const p of thu.picks) {
      const expect = Math.round(p.open * 100) > Math.round(p.close * 100) ? "up" : Math.round(p.open * 100) < Math.round(p.close * 100) ? "down" : "flat";
      ok(p.outcome === expect, `${p.ticker}: close ${p.close} → open ${p.open} is "${p.outcome}"`);
      ok(p.result === (expect === "flat" ? "push" : expect === p.side ? "win" : "loss"), `${p.ticker}: pick ${p.side} scored ${p.result}`);
    }
    ok(s.stats.streak === 3, "streak still 3 on Friday before picking (there's still time)");
    console.log("  info", JSON.stringify(s.stats));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
} catch (e) {
  fail++;
  console.log("  FAIL", "request error:", e?.cause?.code ?? e?.message ?? e);
  console.log(`\n${pass} passed, ${fail} failed`);
}
process.exit(fail ? 1 : 0);
