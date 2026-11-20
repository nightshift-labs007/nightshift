// Text builders for the X agent's accuracy posts. No imports, so they can be tested without X keys or network
// (test/x-text.test.mjs). They take ONLY calls recorded on Base before the open (each must carry its transaction);
// the shift-report replay reads futures at the moment of the open and must never be described as a recorded miss,
// so it has no way in here.

/** A call recorded on Base before an open, graded against the real open. */
export type RecordedCall = {
  token: string;
  session: string; // YYYY-MM-DD, the open it was for
  predicted: number;
  actual: number | null; // the real open, once known
  txId: string; // the Base transaction that recorded the call: required, it's what makes the call "recorded"
  prevClose?: number | null; // the close before that open, for the frozen-price comparison
};

const isTx = (s: unknown) => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);
const missPct = (predicted: number, actual: number) => Math.abs(predicted / actual - 1) * 100;
const pct = (x: number) => `${x.toFixed(x < 0.1 ? 3 : 2)}%`;

/** Only calls that really were recorded (a transaction hash) and have been graded (a positive real open). */
export function gradedRecorded(calls: RecordedCall[]): (RecordedCall & { actual: number })[] {
  return calls.filter((c): c is RecordedCall & { actual: number } => isTx(c.txId) && c.predicted > 0 && typeof c.actual === "number" && c.actual > 0);
}

/** The "graded" post for one open: each recorded call vs the real open. Null (skip the post) when none is graded. */
export function gradedLines(date: string, calls: RecordedCall[], head: string): string[] | null {
  const today = gradedRecorded(calls).filter((c) => c.session === date);
  if (!today.length) return null;
  const lines = today.map((c) => {
    const frozen = c.prevClose && c.prevClose > 0 ? ` (frozen price: ${pct(missPct(c.prevClose, c.actual))})` : "";
    return `${c.token}: off by ${pct(missPct(c.predicted, c.actual))}${frozen}`;
  });
  return [head, "", ...lines, "", "Each call was recorded on Base before the 9:30 ET open."];
}

/**
 * The track-record post: average miss per token over recorded, graded calls. Null when there are fewer than
 * `minCalls` of them (too few to call a "track record").
 */
export function trackRecordLines(calls: RecordedCall[], stamp: string, minCalls = 10): string[] | null {
  const graded = gradedRecorded(calls);
  if (graded.length < minCalls) return null;
  const by = new Map<string, number[]>();
  for (const c of graded) by.set(c.token, [...(by.get(c.token) ?? []), missPct(c.predicted, c.actual)]);
  const sessions = new Set(graded.map((c) => c.session)).size;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [
    `Our recorded calls, last ${sessions} market opens:`,
    "",
    ...[...by].map(([token, xs]) => `${token}: avg miss ${pct(avg(xs))} (${xs.length} calls)`),
    "",
    `Every call was recorded on Base before the open · ${stamp}`,
  ];
}
