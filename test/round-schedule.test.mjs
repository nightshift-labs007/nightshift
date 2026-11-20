// When the keeper may create the evening "Call the Open" rounds, and with which times (lib/time.ts eveningRoundPlan).
// Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { eveningRoundPlan } from "../lib/time.ts";

const ms = (iso) => Date.parse(iso);
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

// November 2026 is EST (UTC-5): 16:00 ET = 21:00Z, 20:00 ET = 01:00Z next day, 09:00 ET = 14:00Z.
const THU_CLOSE = ms("2026-11-19T21:00:00Z");

test("weekday evening after 20:00 ET opens the next morning's rounds", () => {
  const plan = eveningRoundPlan(ms("2026-11-20T01:05:00Z"), THU_CLOSE); // Thu 20:05 ET
  assert.deepEqual(plan, { ok: true, session: "2026-11-20", lockTime: sec("2026-11-20T14:00:00Z"), marketOpen: sec("2026-11-20T14:30:00Z") });
});

test("before 20:00 ET it waits for the evening call", () => {
  const plan = eveningRoundPlan(ms("2026-11-20T00:30:00Z"), THU_CLOSE); // Thu 19:30 ET
  assert.deepEqual(plan, { ok: false, reason: "before the evening call", session: "2026-11-20" });
});

test("the team's early flag skips the evening wait", () => {
  const plan = eveningRoundPlan(ms("2026-11-19T22:00:00Z"), THU_CLOSE, { early: true }); // Thu 17:00 ET
  assert.equal(plan.ok, true);
  assert.equal(plan.session, "2026-11-20");
});

test("never while the market is open", () => {
  assert.deepEqual(eveningRoundPlan(ms("2026-11-19T18:00:00Z"), ms("2026-11-18T21:00:00Z"), { marketOpen: true }), { ok: false, reason: "market open" });
});

test("Friday evening targets Monday's open (weekend round)", () => {
  const plan = eveningRoundPlan(ms("2026-11-21T01:30:00Z"), ms("2026-11-20T21:00:00Z")); // Fri 20:30 ET
  assert.equal(plan.ok, true);
  assert.equal(plan.session, "2026-11-23");
  assert.equal(plan.lockTime, sec("2026-11-23T14:00:00Z"));
});

test("a weekend run still targets Monday", () => {
  const plan = eveningRoundPlan(ms("2026-11-22T15:00:00Z"), ms("2026-11-20T21:00:00Z")); // Sun 10:00 ET
  assert.equal(plan.ok, true);
  assert.equal(plan.session, "2026-11-23");
});

test("skips a market holiday (Thanksgiving, Thu 26 Nov 2026)", () => {
  const plan = eveningRoundPlan(ms("2026-11-26T02:00:00Z"), ms("2026-11-25T21:00:00Z")); // Wed 21:00 ET
  assert.equal(plan.ok, true);
  assert.equal(plan.session, "2026-11-27");
});

test("after an early close (13:00 ET) the call comes at 17:00 ET", () => {
  const close = ms("2026-11-27T18:00:00Z"); // Fri 27 Nov, 13:00 ET
  assert.equal(eveningRoundPlan(ms("2026-11-27T21:59:00Z"), close).ok, false); // 16:59 ET
  const plan = eveningRoundPlan(ms("2026-11-27T22:01:00Z"), close); // 17:01 ET
  assert.equal(plan.ok, true);
  assert.equal(plan.session, "2026-11-30");
});

test("refuses within 30 minutes of the lock", () => {
  const plan = eveningRoundPlan(ms("2026-11-20T13:45:00Z"), THU_CLOSE); // Fri 08:45 ET
  assert.deepEqual(plan, { ok: false, reason: "too close to the open", session: "2026-11-20" });
});

test("summer time (EDT): lock at 09:00 ET is 13:00Z, and the 3 July 2026 holiday is skipped", () => {
  const plan = eveningRoundPlan(ms("2026-07-03T00:30:00Z"), ms("2026-07-02T20:00:00Z")); // Thu 2 Jul, 20:30 EDT
  assert.equal(plan.ok, true);
  assert.equal(plan.session, "2026-07-06");
  assert.equal(plan.lockTime, sec("2026-07-06T13:00:00Z"));
  assert.equal(plan.marketOpen, sec("2026-07-06T13:30:00Z"));
});
