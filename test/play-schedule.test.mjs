// Points game calendar (lib/time.ts): which round takes picks, when it locks, which open settles it. Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { currentPlayRound, nextTradingDate, playRoundFor, playRoundsBetween, prevTradingDate } from "../lib/time.ts";

const ms = (iso) => Date.parse(iso);
// November 2026 is EST: 16:00 ET = 21:00Z, 09:30 ET = 14:30Z, 13:00 ET = 18:00Z.

test("during the trading day, picks go to today's close and settle at tomorrow's open", () => {
  assert.deepEqual(currentPlayRound(ms("2026-11-19T15:00:00Z")), {
    date: "2026-11-19",
    lockMs: ms("2026-11-19T21:00:00Z"),
    settleDate: "2026-11-20",
    openMs: ms("2026-11-20T14:30:00Z"),
  });
});

test("the lock is exactly the close: one millisecond before is today's round, the close itself is the next one", () => {
  assert.equal(currentPlayRound(ms("2026-11-19T20:59:59.999Z")).date, "2026-11-19");
  assert.equal(currentPlayRound(ms("2026-11-19T21:00:00Z")).date, "2026-11-20");
});

test("overnight and before the open, picks go to the coming day's close", () => {
  assert.equal(currentPlayRound(ms("2026-11-20T03:00:00Z")).date, "2026-11-20"); // Thu 22:00 ET
  assert.equal(currentPlayRound(ms("2026-11-20T13:00:00Z")).date, "2026-11-20"); // Fri 08:00 ET
});

test("Friday's round is the weekend round: Friday close → Monday open", () => {
  const r = currentPlayRound(ms("2026-11-20T18:00:00Z")); // Fri 13:00 ET
  assert.equal(r.date, "2026-11-20");
  assert.equal(r.settleDate, "2026-11-23");
  assert.equal(r.openMs, ms("2026-11-23T14:30:00Z"));
});

test("after Friday's close and all weekend, picks go to Monday's round", () => {
  for (const t of ["2026-11-20T21:00:01Z", "2026-11-21T15:00:00Z", "2026-11-22T23:00:00Z"]) {
    const r = currentPlayRound(ms(t));
    assert.equal(r.date, "2026-11-23", t);
    assert.equal(r.settleDate, "2026-11-24", t);
  }
});

test("Thanksgiving is skipped, and the early close (13:00 ET) is the lock on 27 Nov", () => {
  const wed = playRoundFor("2026-11-25");
  assert.equal(wed.settleDate, "2026-11-27");
  const fri = currentPlayRound(ms("2026-11-25T21:00:00Z")); // Wed close passed
  assert.equal(fri.date, "2026-11-27");
  assert.equal(fri.lockMs, ms("2026-11-27T18:00:00Z"));
  assert.equal(fri.settleDate, "2026-11-30");
  assert.equal(currentPlayRound(ms("2026-11-27T18:00:01Z")).date, "2026-11-30");
});

test("summer time: 16:00 EDT = 20:00Z, and the 3 July 2026 holiday is skipped", () => {
  const r = currentPlayRound(ms("2026-07-02T15:00:00Z"));
  assert.equal(r.date, "2026-07-02");
  assert.equal(r.lockMs, ms("2026-07-02T20:00:00Z"));
  assert.equal(r.settleDate, "2026-07-06");
  assert.equal(r.openMs, ms("2026-07-06T13:30:00Z"));
});

test("trading-date stepping and round spans", () => {
  assert.equal(nextTradingDate("2026-11-20"), "2026-11-23");
  assert.equal(prevTradingDate("2026-11-23"), "2026-11-20");
  assert.equal(prevTradingDate("2026-11-27"), "2026-11-25");
  assert.deepEqual(playRoundsBetween("2026-11-24", "2026-11-30"), ["2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30"]);
  assert.deepEqual(playRoundsBetween("2026-11-21", "2026-11-23"), ["2026-11-23"]); // a weekend start rolls forward
});
