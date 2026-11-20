import "server-only";
import { PLAY_TICKERS, VOID_AFTER_HOURS, outcomeOf, type AssetResult } from "@/lib/play-rules";
import { officialClose, officialOpen } from "@/lib/prices";
import { aiRoundFor, playRoundFor } from "@/lib/time";
import { getAiCall } from "./ai";
import { getResult, roundsWithPicks, setResult, tryLock, type Mode } from "./store";

/**
 * Settling the points games. Prices come from the price provider (lib/prices: Yahoo by default, cached and backed
 * off). Anything missing or unconfirmed means "not yet": the round is retried later. A round still missing prices
 * VOID_AFTER_HOURS after the open is voided (no points either way, streaks unaffected).
 *
 * - "close" game, round D: the strike is the official close of D, decided by the next trading date's open.
 * - "ai" game, session S: the strike is Nightshift's call recorded the evening before, decided by S's open.
 */
const SETTLE_DELAY_MS = 5 * 60_000; // give the opening prints a few minutes to appear
const MAX_ROUNDS_PER_CALL = 2; // bounds the price requests one call can trigger
const ROUND_BUDGET_MS = 20_000; // one round's lookups give up after this and retry on a later call

/** Resolves to null if `p` hasn't settled within `ms` (the lookups keep running but nobody waits for them). */
const withDeadline = <T,>(p: Promise<T>, ms: number) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export type SettleOutcome = { mode: Mode; date: string; status: "settled" | "void" | "waiting" | "too early" | "already"; missing?: string[] };

function timing(mode: Mode, date: string) {
  if (mode === "ai") {
    const r = aiRoundFor(date);
    return { openMs: r.openMs, openDate: date };
  }
  const r = playRoundFor(date);
  return { openMs: r.openMs, openDate: r.settleDate };
}

/** Settles one round if its open has happened and every price is confirmed. Idempotent. */
export async function settleRound(date: string, nowMs: number, mode: Mode = "close"): Promise<SettleOutcome> {
  if (await getResult(date, mode)) return { mode, date, status: "already" };
  const { openMs, openDate } = timing(mode, date);
  if (nowMs < openMs + SETTLE_DELAY_MS) return { mode, date, status: "too early" };

  const call = mode === "ai" ? await getAiCall(date) : null;
  const strikeOf = async (t: string) => (mode === "ai" ? (call?.p[t] ?? null) : officialClose(t, date));
  const prices = await withDeadline(
    Promise.all(PLAY_TICKERS.map(async (t) => [t, await strikeOf(t), await officialOpen(t, openDate)] as const)),
    ROUND_BUDGET_MS,
  );
  const assets: Record<string, AssetResult> = {};
  const missing: string[] = [];
  for (const t of PLAY_TICKERS) {
    const row = prices?.find((x) => x[0] === t);
    const strike = row?.[1] ?? null;
    const open = row?.[2] ?? null;
    if (strike && open) assets[t] = { close: strike, open: open.open, outcome: outcomeOf(strike, open.open) };
    else if (!(mode === "ai" && call && call.p[t] === undefined)) missing.push(t); // an asset with no call was never playable
  }
  if (!missing.length && Object.keys(assets).length) {
    await setResult({ date, status: "settled", assets, settledAt: nowMs }, mode);
    return { mode, date, status: "settled" };
  }
  if (nowMs > openMs + VOID_AFTER_HOURS * 3600_000) {
    await setResult({ date, status: "void", reason: `no confirmed prices for ${missing.join(", ") || "any asset"}`, settledAt: nowMs }, mode);
    return { mode, date, status: "void", missing };
  }
  return { mode, date, status: "waiting", missing };
}

/** Settles due rounds of both games, oldest first, a couple per call. Safe to call from any request or the keeper. */
export async function settleDue(nowMs: number, opts: { noLock?: boolean } = {}): Promise<SettleOutcome[]> {
  if (!opts.noLock && !(await tryLock("play:settling", 90))) return [];
  const out: SettleOutcome[] = [];
  const worked = () => out.filter((o) => o.status !== "already" && o.status !== "too early").length;
  for (const mode of ["close", "ai"] as const) {
    for (const date of await roundsWithPicks(mode)) {
      if (worked() >= MAX_ROUNDS_PER_CALL) return out;
      if (nowMs < timing(mode, date).openMs + SETTLE_DELAY_MS) continue;
      out.push(await settleRound(date, nowMs, mode));
    }
  }
  return out;
}
