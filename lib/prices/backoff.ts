// Exponential backoff for a price source that rate-limits or fails (HTTP 429/5xx, timeouts). No imports, so the
// test runner can load it (test/prices.test.mjs). While a source is cooling down we don't call it at all, which is
// what lets a rate limit clear instead of being extended by every page load.

export type Backoff = { failures: number; until: number };

export const BACKOFF_BASE_MS = 60_000; // 1 min after the first failure
export const BACKOFF_MAX_MS = 30 * 60_000; // never more than 30 min

export const fresh = (): Backoff => ({ failures: 0, until: 0 });

/** After a failure: 1, 2, 4, 8, 16, 30, 30… minutes. */
export function afterFailure(b: Backoff | undefined, nowMs: number): Backoff {
  const failures = (b?.failures ?? 0) + 1;
  return { failures, until: nowMs + Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS) };
}

export const coolingDown = (b: Backoff | undefined, nowMs: number) => !!b && b.until > nowMs;

/** Should this HTTP status put the source into backoff? (Not-found or a bad symbol is our problem, not theirs.) */
export const isThrottle = (status: number | null) => status === null || status === 429 || status >= 500;
