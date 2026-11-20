import "server-only";
import { officialOpen } from "@/lib/data";
import { PLAY_TICKERS, VOID_AFTER_HOURS, outcomeOf, type AssetResult } from "@/lib/play-rules";
import { closeUtcMs, etParts, playRoundFor } from "@/lib/time";
import { getResult, roundsWithPicks, setResult, tryLock } from "./store";

/**
 * Settling the points game. Data source: Yahoo Finance's public chart API (unofficial, no key; consolidated US tape).
 *
 * - CLOSE of the lock date D: the `close` of Yahoo's daily bar for D, accepted only if it is within 0.5% of the close
 *   of D's last 5-minute bar (a sanity check that the daily bar really is D's, not a neighbour's).
 * - OPEN of the next trading date: `officialOpen()` (the keeper's rule for "Call the Open"): the opens of the 1-minute
 *   and 5-minute bars that start exactly at 09:30:00 ET must agree within 0.3%.
 *
 * Anything missing, rate-limited or disagreeing means "not yet": the round is retried on the next call. A round still
 * missing prices VOID_AFTER_HOURS after the open is voided (no points either way, streaks unaffected).
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SETTLE_DELAY_MS = 5 * 60_000; // give the opening prints a few minutes to appear
const MAX_ROUNDS_PER_CALL = 2; // bounds the Yahoo requests one page load can trigger
const ROUND_BUDGET_MS = 20_000; // one round's price lookups give up after this and retry on a later call

/** Resolves to null if `p` hasn't settled within `ms` (the lookups keep running but nobody waits for them). */
const withDeadline = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

async function chart(symbol: string, query: string) {
  for (const host of ["query1", "query2"]) {
    const res = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res?.ok) continue; // 429 on one host: try the other
    const r = (await res.json().catch(() => null))?.chart?.result?.[0];
    if (r) return r as { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; close?: (number | null)[] }[] } };
  }
  return null;
}

/** The official close of `symbol` on trading date `date`, or null when it can't be confirmed yet. */
export async function officialClose(symbol: string, date: string): Promise<number | null> {
  const [daily, fine] = await Promise.all([chart(symbol, "interval=1d&range=1mo"), chart(symbol, "interval=5m&range=5d")]);
  const dTs = daily?.timestamp ?? [];
  const dClose = daily?.indicators?.quote?.[0]?.close ?? [];
  let close: number | null = null;
  for (let i = 0; i < dTs.length; i++) {
    // daily bars are stamped at the session start; nudge past midnight-stamped bars, as toSessions() does
    if (etParts(dTs[i] * 1000 + 3 * 3600_000).date === date && typeof dClose[i] === "number") close = dClose[i] as number;
  }
  const lastBarT = closeUtcMs(date) / 1000 - 300; // the 5-minute bar that ends at the close
  const fTs = fine?.timestamp ?? [];
  const k = fTs.indexOf(lastBarT);
  const check = k >= 0 ? fine?.indicators?.quote?.[0]?.close?.[k] : null;
  if (!(close && close > 0) || typeof check !== "number" || !(check > 0)) return null;
  if (Math.abs(close / check - 1) > 0.005) return null;
  return close;
}

export type SettleOutcome = { date: string; status: "settled" | "void" | "waiting" | "too early" | "already" ; missing?: string[] };

/** Settles one round if its open has happened and every price is confirmed. Idempotent. */
export async function settleRound(date: string, nowMs: number): Promise<SettleOutcome> {
  if (await getResult(date)) return { date, status: "already" };
  const round = playRoundFor(date);
  if (nowMs < round.openMs + SETTLE_DELAY_MS) return { date, status: "too early" };
  const assets: Record<string, AssetResult> = {};
  const missing: string[] = [];
  // all assets at once, with a hard time budget: a slow or throttling Yahoo means "try again later", never a hung request
  const prices = await withDeadline(
    Promise.all(PLAY_TICKERS.map(async (t) => [t, await officialClose(t, date), await officialOpen(t, round.settleDate)] as const)),
    ROUND_BUDGET_MS,
  );
  for (const t of PLAY_TICKERS) {
    const row = prices?.find((x) => x[0] === t);
    const close = row?.[1] ?? null;
    const open = row?.[2] ?? null;
    if (close && open) assets[t] = { close, open: open.open, outcome: outcomeOf(close, open.open) };
    else missing.push(t);
  }
  if (!missing.length) {
    await setResult({ date, status: "settled", assets, settledAt: nowMs });
    return { date, status: "settled" };
  }
  if (nowMs > round.openMs + VOID_AFTER_HOURS * 3600_000) {
    await setResult({ date, status: "void", reason: `no confirmed prices for ${missing.join(", ")}`, settledAt: nowMs });
    return { date, status: "void", missing };
  }
  return { date, status: "waiting", missing };
}

/** Settles due rounds that have picks, oldest first, a couple per call. Safe to call from any request or the keeper. */
export async function settleDue(nowMs: number): Promise<SettleOutcome[]> {
  if (!(await tryLock("play:settling", 90))) return [];
  const out: SettleOutcome[] = [];
  for (const date of await roundsWithPicks()) {
    if (out.filter((o) => o.status !== "already" && o.status !== "too early").length >= MAX_ROUNDS_PER_CALL) break;
    if (nowMs < playRoundFor(date).openMs + SETTLE_DELAY_MS) continue;
    out.push(await settleRound(date, nowMs));
  }
  return out;
}
