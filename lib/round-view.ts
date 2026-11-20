// How a "Call the Open" round should be shown, from its on-chain state and the clock. No imports, so Node's test runner
// can load it directly (test/round-view.test.mjs). Shared by the Predict tab.

type RoundLike = { status: string; lockTime: number; marketOpen: number; stakeHigher: number; stakeLower: number };

/**
 * - open:         predictions are being taken (before the lock)
 * - waiting-open: locked, the open hasn't happened yet
 * - settling:     the open has happened; the result is being proposed or is in its challenge window
 * - overdue:      more than a day past the open and still not settled (the keeper isn't running)
 * - done:         settled or cancelled
 */
export type RoundPhase = "open" | "waiting-open" | "settling" | "overdue" | "done";

export const OVERDUE_AFTER_SEC = 24 * 3600;

export function roundPhase(r: Pick<RoundLike, "status" | "lockTime" | "marketOpen">, nowSec: number): RoundPhase {
  if (r.status === "Settled" || r.status === "Cancelled") return "done";
  if (r.status === "Open" && nowSec < r.lockTime) return "open";
  if (nowSec < r.marketOpen) return "waiting-open";
  if (nowSec < r.marketOpen + OVERDUE_AFTER_SEC) return "settling";
  return "overdue";
}

/**
 * The stale-data guard: a round's call may be put next to a live price only until its own open. After that the live
 * price belongs to a later session, so comparing them (e.g. a call from two weeks ago vs today's price) is meaningless.
 */
export const showsLiveComparison = (phase: RoundPhase) => phase === "open" || phase === "waiting-open";

/** Whether every round in a set is past its open and unsettled for over a day: the rounds shown are stale. */
export const allOverdue = (rounds: Pick<RoundLike, "status" | "lockTime" | "marketOpen">[], nowSec: number) =>
  rounds.length > 0 && rounds.every((r) => roundPhase(r, nowSec) === "overdue");

/**
 * What the pool row should say for one side, instead of a misleading "pays 1.00×" when nobody is on the other side.
 * - empty:     nobody has predicted on either side ("Be the first to call it")
 * - no-rival:  nobody is on the other side yet, so a win would only refund the stake
 * - pays:      a real payout multiple can be shown
 */
export type PoolView = { kind: "empty" } | { kind: "no-rival" } | { kind: "pays" };

export function poolView(r: Pick<RoundLike, "stakeHigher" | "stakeLower">, side: "Higher" | "Lower"): PoolView {
  if (r.stakeHigher + r.stakeLower <= 0) return { kind: "empty" };
  const other = side === "Higher" ? r.stakeLower : r.stakeHigher;
  return other > 0 ? { kind: "pays" } : { kind: "no-rival" };
}
