// Go-live operations rules (lib/ops-rules.ts) and test-mode gating (lib/play/testmode.ts). Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { addDays, jobStale, retention, scrub } from "../lib/ops-rules.ts";
import { testMode } from "../lib/play/testmode.ts";

const MIN = 60_000;
const beat = (o) => ({ lastRunAt: null, lastScheduledAt: null, lastOkAt: null, lastError: null, lastErrorAt: null, lastSummary: null, ...o });

test("a job is stale after 3 missed intervals of scheduled, successful runs", () => {
  const now = 1_000 * MIN;
  assert.equal(jobStale("settle", null, now), true, "never ran");
  assert.equal(jobStale("settle", beat({ lastScheduledAt: now - 14 * MIN, lastOkAt: now - 14 * MIN }), now), false);
  assert.equal(jobStale("settle", beat({ lastScheduledAt: now - 16 * MIN, lastOkAt: now - 16 * MIN }), now), true);
  assert.equal(jobStale("keeper", beat({ lastScheduledAt: now - 29 * MIN, lastOkAt: now - 29 * MIN }), now), false, "keeper runs every 10 min");
});

test("page-triggered runs don't hide a stopped scheduler", () => {
  const now = 1_000 * MIN;
  assert.equal(jobStale("settle", beat({ lastRunAt: now, lastOkAt: now, lastScheduledAt: now - 60 * MIN }), now), true);
});

test("a scheduler that runs but keeps failing is stale", () => {
  const now = 1_000 * MIN;
  assert.equal(jobStale("settle", beat({ lastScheduledAt: now - MIN, lastOkAt: now - 120 * MIN, lastError: "boom" }), now), true);
});

test("scrub removes secrets, emails, long hex and ids, and caps length", () => {
  const s = scrub("failed: Bearer abc123 for me@x.com key=sk_live_9 0x" + "a".repeat(64) + " uid 123e4567-e89b-12d3-a456-426614174000");
  assert.doesNotMatch(s, /abc123|me@x\.com|sk_live_9|a{40}|123e4567/);
  assert.equal(scrub("x".repeat(1000)).length, 300);
});

test("day-1 and day-7 return by first-seen cohort", () => {
  const first = { a: "2026-11-02", b: "2026-11-02", c: "2026-11-02", d: "2026-11-08" };
  const active = { "2026-11-03": ["a", "b"], "2026-11-09": ["a", "d"], "2026-11-10": ["c"] };
  assert.deepEqual(retention(first, active, "2026-11-10"), [
    { date: "2026-11-02", users: 3, d1: 2, d7: 1 },
    { date: "2026-11-08", users: 1, d1: 1, d7: null }, // day 7 hasn't happened yet: null, not 0
  ]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("test mode: on locally, on a preview only with the flag, never in production", () => {
  const save = { ...process.env };
  try {
    process.env.NODE_ENV = "development";
    assert.equal(testMode(), true);
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.PLAY_TEST_MODE = "1";
    assert.equal(testMode(), false, "production without Vercel preview: off even with the flag");
    process.env.VERCEL_ENV = "production";
    assert.equal(testMode(), false, "Vercel production: off even with the flag");
    process.env.VERCEL_ENV = "preview";
    assert.equal(testMode(), true, "Vercel preview with the flag: on");
    delete process.env.PLAY_TEST_MODE;
    assert.equal(testMode(), false, "Vercel preview without the flag: off");
  } finally {
    for (const k of ["NODE_ENV", "VERCEL_ENV", "PLAY_TEST_MODE"]) {
      if (save[k] === undefined) delete process.env[k];
      else process.env[k] = save[k];
    }
  }
});
