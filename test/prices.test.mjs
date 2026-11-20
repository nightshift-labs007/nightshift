// Price provider building blocks (lib/prices): backoff and confirming Yahoo's close/open. Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { BACKOFF_MAX_MS, afterFailure, coolingDown, fresh, isThrottle } from "../lib/prices/backoff.ts";
import { confirmClose, confirmOpen, dailyClose } from "../lib/prices/yahoo-parse.ts";

test("backoff doubles from 1 minute and stops at 30", () => {
  let b = fresh();
  const waits = [];
  for (let i = 0; i < 8; i++) {
    b = afterFailure(b, 0);
    waits.push(b.until / 60_000);
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 16, 30, 30, 30]);
  assert.equal(afterFailure({ failures: 50, until: 0 }, 0).until, BACKOFF_MAX_MS);
});

test("cooling down until the backoff ends; a success resets it", () => {
  const b = afterFailure(fresh(), 1000);
  assert.equal(coolingDown(b, 1000 + 59_999), true);
  assert.equal(coolingDown(b, 1000 + 60_000), false);
  assert.equal(coolingDown(fresh(), 0), false);
  assert.equal(coolingDown(undefined, 0), false);
});

test("which failures count as throttling", () => {
  for (const s of [429, 500, 502, 503, null]) assert.equal(isThrottle(s), true, String(s));
  for (const s of [400, 404]) assert.equal(isThrottle(s), false, String(s));
});

// fixture: Thu 19 Nov 2026 (EST). Daily bar stamped 09:30 ET = 14:30Z; last 5-min bar starts 15:55 ET = 20:55Z.
const etDate = (ms) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10); // EST is enough for this fixture
const T = (iso) => Date.parse(iso) / 1000;
const daily = { timestamp: [T("2026-11-18T14:30:00Z"), T("2026-11-19T14:30:00Z")], indicators: { quote: [{ close: [720.1, 715.87] }] } };
const five = (close) => ({ timestamp: [T("2026-11-19T20:50:00Z"), T("2026-11-19T20:55:00Z")], indicators: { quote: [{ close: [716.2, close] }] } });

test("the close is the daily bar's close for that date", () => {
  assert.equal(dailyClose(daily, "2026-11-19", etDate), 715.87);
  assert.equal(dailyClose(daily, "2026-11-20", etDate), null);
});

test("the close is confirmed only if the last 5-minute bar agrees within 0.5%", () => {
  const last = T("2026-11-19T20:55:00Z");
  assert.equal(confirmClose(daily, five(715.5), "2026-11-19", last, etDate), 715.87);
  assert.equal(confirmClose(daily, five(700), "2026-11-19", last, etDate), null, "disagreement: not confirmed");
  assert.equal(confirmClose(daily, null, "2026-11-19", last, etDate), null, "second reading missing (e.g. rate-limited)");
  assert.equal(confirmClose(null, five(715.5), "2026-11-19", last, etDate), null);
});

test("the open needs the 1-minute and 5-minute 09:30 bars to agree within 0.3%", () => {
  const open = T("2026-11-20T14:30:00Z");
  const bar = (o) => ({ timestamp: [open], indicators: { quote: [{ open: [o] }] } });
  assert.deepEqual(confirmOpen(bar(713.56), bar(713.6), open), { open: 713.56, check: 713.6 });
  assert.equal(confirmOpen(bar(713.56), bar(720), open), null);
  assert.equal(confirmOpen(bar(713.56), { timestamp: [open + 300], indicators: { quote: [{ open: [713.6] }] } }, open), null, "no bar exactly at 09:30");
});
