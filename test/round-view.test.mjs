// The stale-data guard and pool labels for "Call the Open" rounds (lib/round-view.ts). Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { allOverdue, poolView, roundPhase, showsLiveComparison } from "../lib/round-view.ts";

const lock = 1_000_000;
const open = lock + 1800;
const round = (status, extra = {}) => ({ status, lockTime: lock, marketOpen: open, stakeHigher: 0, stakeLower: 0, ...extra });

test("phases follow the clock", () => {
  assert.equal(roundPhase(round("Open"), lock - 1), "open");
  assert.equal(roundPhase(round("Open"), lock + 1), "waiting-open");
  assert.equal(roundPhase(round("Open"), open + 60), "settling");
  assert.equal(roundPhase(round("Proposed"), open + 600), "settling");
  assert.equal(roundPhase(round("Proposed"), open + 24 * 3600 + 1), "overdue");
  assert.equal(roundPhase(round("Settled"), open + 10 * 86400), "done");
  assert.equal(roundPhase(round("Cancelled"), lock - 1), "done");
});

test("a call is shown next to a live price only until its own open", () => {
  assert.equal(showsLiveComparison(roundPhase(round("Open"), lock - 1)), true);
  assert.equal(showsLiveComparison(roundPhase(round("Open"), open - 1)), true);
  assert.equal(showsLiveComparison(roundPhase(round("Open"), open + 1)), false);
});

test("regression: a Proposed round two weeks old is never compared with today's price", () => {
  const twoWeeksLater = open + 14 * 86400;
  const phase = roundPhase(round("Proposed"), twoWeeksLater);
  assert.equal(phase, "overdue");
  assert.equal(showsLiveComparison(phase), false);
});

test("allOverdue: only when every round in the set is overdue", () => {
  const later = open + 2 * 86400;
  assert.equal(allOverdue([round("Proposed"), round("Open")], later), true);
  assert.equal(allOverdue([round("Proposed"), round("Settled")], later), false);
  assert.equal(allOverdue([], later), false);
  assert.equal(allOverdue([round("Proposed")], open + 60), false);
});

test("empty pools never show a payout multiple", () => {
  assert.deepEqual(poolView(round("Open"), "Higher"), { kind: "empty" });
  assert.deepEqual(poolView(round("Open", { stakeHigher: 5 }), "Higher"), { kind: "no-rival" });
  assert.deepEqual(poolView(round("Open", { stakeHigher: 5 }), "Lower"), { kind: "pays" });
  assert.deepEqual(poolView(round("Open", { stakeHigher: 5, stakeLower: 3 }), "Higher"), { kind: "pays" });
});
