// Points game rules (lib/play-rules.ts): the flat rule, scoring, streaks and accuracy. Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { POINTS, outcomeOf, playStats, scorePick } from "../lib/play-rules.ts";

const settled = (date, assets) => ({ date, status: "settled", settledAt: 0, assets });
const res = (close, open) => ({ close, open, outcome: outcomeOf(close, open) });

test("flat rule: compared to the cent", () => {
  assert.equal(outcomeOf(100, 100.01), "up");
  assert.equal(outcomeOf(100, 99.99), "down");
  assert.equal(outcomeOf(100, 100), "flat");
  assert.equal(outcomeOf(100.004, 100.001), "flat"); // both round to $100.00
  assert.equal(outcomeOf(100.004, 100.006), "up"); // $100.00 → $100.01
  assert.equal(outcomeOf(187.5, 187.495), "flat"); // both round to $187.50
});

test("scoring a pick", () => {
  const r = settled("2026-11-19", { NVDA: res(140, 141), SPY: res(700, 699), GLD: res(330, 330) });
  assert.equal(scorePick("up", r, "NVDA"), "win");
  assert.equal(scorePick("down", r, "NVDA"), "loss");
  assert.equal(scorePick("down", r, "SPY"), "win");
  assert.equal(scorePick("up", r, "GLD"), "push");
  assert.equal(scorePick("up", null, "NVDA"), "pending");
  assert.equal(scorePick("up", { date: "2026-11-19", status: "void", reason: "x", settledAt: 0 }, "NVDA"), "void");
  assert.equal(scorePick("up", r, "TSLA"), "void"); // asset missing from a settled result: never scored
});

test("points: 10 per correct pick, nothing for wrong, pushes or voids", () => {
  const s = playStats([
    { date: "d1", picks: { NVDA: "up", SPY: "up", GLD: "down" }, result: settled("d1", { NVDA: res(1, 2), SPY: res(2, 1), GLD: res(5, 5) }) },
  ]);
  assert.equal(s.points, POINTS.correct);
  assert.deepEqual([s.wins, s.losses, s.pushes], [1, 1, 1]);
  assert.equal(s.accuracy, 0.5);
});

test("streak: rounds played in a row; a skipped locked round resets it; the open round counts only once picked", () => {
  const up = (d) => settled(d, { NVDA: res(1, 2) });
  const rounds = [
    { date: "d1", picks: { NVDA: "up" }, result: up("d1") },
    { date: "d2", picks: {}, result: up("d2") }, // skipped
    { date: "d3", picks: { NVDA: "up" }, result: up("d3") },
    { date: "d4", picks: { NVDA: "up" }, result: up("d4") },
  ];
  assert.equal(playStats(rounds).streak, 2);
  assert.equal(playStats(rounds).bestStreak, 2);
  assert.equal(playStats([...rounds, { date: "d5", picks: {}, result: null, open: true }]).streak, 2, "not picked yet: still time");
  assert.equal(playStats([...rounds, { date: "d5", picks: { NVDA: "up" }, result: null, open: true }]).streak, 3);
});

test("streak bonus: +5 for each settled round played on a streak of 3 or more", () => {
  const up = (d) => settled(d, { NVDA: res(1, 2) });
  const rounds = ["d1", "d2", "d3", "d4"].map((d) => ({ date: d, picks: { NVDA: "up" }, result: up(d) }));
  const s = playStats(rounds);
  assert.equal(s.points, 4 * POINTS.correct + 2 * POINTS.streakBonus); // rounds 3 and 4
  assert.equal(s.streak, 4);
});

test("pending and void rounds keep the streak but earn nothing", () => {
  const s = playStats([
    { date: "d1", picks: { NVDA: "up" }, result: { date: "d1", status: "void", reason: "x", settledAt: 0 } },
    { date: "d2", picks: { NVDA: "up" }, result: null },
    { date: "d3", picks: { NVDA: "up" }, result: null },
  ]);
  assert.equal(s.points, 0);
  assert.equal(s.streak, 3);
  assert.equal(s.pending, 2);
  assert.equal(s.accuracy, null);
});
