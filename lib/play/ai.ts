import "server-only";
import { getOracleSnapshot } from "@/lib/oracle";
import { PLAY_TICKERS } from "@/lib/play-rules";
import { getStockBoard } from "@/lib/stocks";
import { currentAiRound } from "@/lib/time";
import { sGet, sSet, tryLock } from "./store";
import { testMode } from "@/lib/play/testmode";

/**
 * Nightshift's evening call for "Beat the AI": the engine's fair value for each game asset, taken once per session
 * after the evening call time (20:00 ET) and stored unchanged. Players pick whether the open lands above or below it.
 * The call is kept off-chain (it decides points only); it is never described as recorded on Base.
 */
export type AiCall = { session: string; at: number; p: Record<string, number> };

const KEY = (session: string) => `play:ai:call:${session}`;

export async function getAiCall(session: string): Promise<AiCall | null> {
  const v = await sGet(KEY(session));
  try {
    return v ? (JSON.parse(v) as AiCall) : null;
  } catch {
    return null;
  }
}

/** Test-only (non-production): set a call for a past or future session, so settlement can be tested on real opens. */
export async function setAiCallForTest(call: AiCall) {
  if (!testMode()) throw new Error("test mode only");
  await sSet(KEY(call.session), JSON.stringify(call));
}

/**
 * Takes the call for the current round if its time has come and it doesn't exist yet. Uses only live (not simulated)
 * prices, and only while the market is closed; an asset without a live price is left out of that night's round.
 */
export async function ensureAiCall(nowMs: number): Promise<AiCall | null> {
  const round = currentAiRound(nowMs);
  const existing = await getAiCall(round.date);
  if (existing || nowMs < round.callMs || nowMs >= round.lockMs) return existing;
  if (!(await tryLock(`play:ai:calling:${round.date}`, 120))) return null;
  const [snap, board] = await Promise.all([getOracleSnapshot(), getStockBoard()]);
  if (snap.market.open) return null;
  const p: Record<string, number> = {};
  for (const t of PLAY_TICKERS) {
    const q = snap.quotes.find((x) => x.token === t && x.source === "live");
    const s = board.stocks.find((x) => x.ticker === t);
    const v = q?.fairValue ?? s?.fairValue;
    if (typeof v === "number" && v > 0) p[t] = Math.round(v * 100) / 100; // to the cent, the precision the game decides at
  }
  if (!Object.keys(p).length) return null;
  const call: AiCall = { session: round.date, at: nowMs, p };
  await sSet(KEY(round.date), JSON.stringify(call));
  return call;
}
