import "server-only";
import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { PLAY_ASSETS, POINTS, VOID_AFTER_HOURS, playStats, scorePick, type PickResult, type PlayStats, type RoundResult, type Side } from "@/lib/play-rules";
import { currentPlayRound, playRoundFor, playRoundsBetween } from "@/lib/time";
import { getCounts, getPicks, getResult, storeKind } from "./store";

export const PLAY_COOKIE = "ns_play";
const UID = /^[0-9a-f-]{36}$/;

/** The player's anonymous id from their cookie (no wallet, no account), or null before their first pick. */
export const playerId = (req: NextRequest) => {
  const v = req.cookies.get(PLAY_COOKIE)?.value ?? "";
  return UID.test(v) ? v : null;
};
export const newPlayerId = () => randomUUID();
export function setPlayerCookie(res: NextResponse, uid: string) {
  res.cookies.set(PLAY_COOKIE, uid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 86400 });
}

/**
 * The clock. Outside production, tests may send `x-play-now: <ISO time>` to play a round at a chosen moment (lock
 * and settlement tests against real past prices). Production always uses the real time.
 */
export function playNow(req: NextRequest): { now: number; overridden: boolean } {
  const h = req.headers.get("x-play-now");
  if (h && process.env.NODE_ENV !== "production") {
    const t = Date.parse(h);
    if (Number.isFinite(t)) return { now: t, overridden: true };
  }
  return { now: Date.now(), overridden: false };
}

export type PlayPick = { ticker: string; side: Side; result: PickResult; close?: number; open?: number; outcome?: string };
export type PlayHistoryRound = { date: string; settleDate: string; status: "pending" | "settled" | "void"; picks: PlayPick[] };
export type PlayState = {
  now: number;
  store: "redis" | "memory";
  round: { date: string; lockAt: number; settleDate: string; opensAt: number };
  assets: typeof PLAY_ASSETS;
  myPicks: Record<string, Side>;
  crowd: Record<string, { up: number; down: number }>; // only for assets you've picked this round (pick first, then see the crowd)
  stats: PlayStats | null;
  history: PlayHistoryRound[]; // your locked rounds, newest first
  rules: { points: typeof POINTS; voidAfterHours: number };
};

export async function playState(uid: string | null, now: number): Promise<PlayState> {
  const cur = currentPlayRound(now);
  const base = {
    now,
    store: storeKind(),
    round: { date: cur.date, lockAt: cur.lockMs, settleDate: cur.settleDate, opensAt: cur.openMs },
    assets: PLAY_ASSETS,
    rules: { points: POINTS, voidAfterHours: VOID_AFTER_HOURS },
  } as const;
  if (!uid) return { ...base, myPicks: {}, crowd: {}, stats: null, history: [] };

  const picks = await getPicks(uid);
  const dates = Object.keys(picks).filter((d) => d <= cur.date).sort();
  const myPicks = picks[cur.date] ?? {};
  const allCounts = Object.keys(myPicks).length ? await getCounts(cur.date) : {};
  const crowd = Object.fromEntries(Object.keys(myPicks).map((t) => [t, allCounts[t] ?? { up: 0, down: 0 }]));
  if (!dates.length) return { ...base, myPicks, crowd, stats: null, history: [] };

  // every round from the first pick to now, so skipped rounds break the streak
  const span = playRoundsBetween(dates[0], cur.date);
  const results = new Map<string, RoundResult | null>(await Promise.all(span.filter((d) => d !== cur.date).map(async (d) => [d, await getResult(d)] as const)));
  const stats = playStats(span.map((d) => ({ date: d, picks: picks[d] ?? {}, result: results.get(d) ?? null, open: d === cur.date })));

  const history: PlayHistoryRound[] = dates
    .filter((d) => d !== cur.date)
    .reverse()
    .slice(0, 10)
    .map((d) => {
      const r = results.get(d) ?? null;
      return {
        date: d,
        settleDate: playRoundFor(d).settleDate,
        status: !r ? "pending" : r.status,
        picks: Object.entries(picks[d]).map(([ticker, side]) => {
          const a = r?.status === "settled" ? r.assets[ticker] : undefined;
          return { ticker, side, result: scorePick(side, r, ticker), ...(a ? { close: a.close, open: a.open, outcome: a.outcome } : {}) };
        }),
      };
    });
  return { ...base, myPicks, crowd, stats, history };
}
