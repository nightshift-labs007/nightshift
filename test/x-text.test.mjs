// The X agent's accuracy posts (lib/x-text.ts): only calls recorded on Base can become "off by" lines. No X keys needed.
// Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { gradedLines, gradedRecorded, trackRecordLines } from "../lib/x-text.ts";

const TX = (n) => `0x${String(n).padStart(64, "0")}`;
const call = (over = {}) => ({ token: "SPY", session: "2026-11-19", predicted: 700, actual: 707, txId: TX(1), prevClose: 714, ...over });

test("a call without a Base transaction is never treated as recorded (e.g. a replay row)", () => {
  assert.equal(gradedRecorded([call({ txId: null })]).length, 0);
  assert.equal(gradedRecorded([call({ txId: "" })]).length, 0);
  assert.equal(gradedRecorded([call({ txId: "replay" })]).length, 0);
  assert.equal(gradedRecorded([call()]).length, 1);
});

test("ungraded calls (no real open yet) are left out", () => {
  assert.equal(gradedRecorded([call({ actual: null })]).length, 0);
  assert.equal(gradedRecorded([call({ actual: 0 })]).length, 0);
});

test("graded post: misses computed from the recorded call vs the real open", () => {
  const lines = gradedLines("2026-11-19", [call(), call({ token: "QQQ", predicted: 600, actual: 600.6, prevClose: 590, txId: TX(2) })], "Graded");
  assert.deepEqual(lines, [
    "Graded",
    "",
    "SPY: off by 0.99% (frozen price: 0.99%)",
    "QQQ: off by 0.100% (frozen price: 1.76%)",
    "",
    "Each call was recorded on Base before the 9:30 ET open.",
  ]);
});

test("graded post is skipped when there is no recorded call for that open", () => {
  assert.equal(gradedLines("2026-11-20", [call()], "Graded"), null);
  assert.equal(gradedLines("2026-11-19", [call({ txId: null })], "Graded"), null);
  assert.equal(gradedLines("2026-11-19", [], "Graded"), null);
});

test("track record needs at least 10 recorded, graded calls and only averages those", () => {
  const nine = Array.from({ length: 9 }, (_, i) => call({ session: `2026-11-${String(i + 1).padStart(2, "0")}`, txId: TX(i + 1) }));
  assert.equal(trackRecordLines(nine, "stamp"), null);
  const replayRows = Array.from({ length: 20 }, () => call({ txId: null, predicted: 707 })); // perfect "replay" rows
  assert.equal(trackRecordLines([...nine, ...replayRows], "stamp"), null, "replay rows must not count toward the record");
  const ten = [...nine, call({ session: "2026-11-10", txId: TX(10) })];
  const lines = trackRecordLines(ten, "stamp");
  assert.deepEqual(lines, ["Our recorded calls, last 10 market opens:", "", "SPY: avg miss 0.99% (10 calls)", "", "Every call was recorded on Base before the open · stamp"]);
});

test("no builder output mentions a replay or invents a win count", () => {
  const all = [
    ...(gradedLines("2026-11-19", [call()], "Graded") ?? []),
    ...(trackRecordLines(Array.from({ length: 10 }, (_, i) => call({ txId: TX(i + 1) })), "s") ?? []),
  ].join("\n");
  assert.doesNotMatch(all, /replay|beat the frozen price \d+ times/i);
});
