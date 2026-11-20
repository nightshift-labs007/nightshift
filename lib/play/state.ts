import "server-only";
import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { PLAY_ASSETS, POINTS, VOID_AFTER_HOURS, playStats, scorePick, weekStart, type PickResult, type PlayStats, type RoundResult, type Side } from "@/lib/play-rules";
import { aiRoundFor, currentAiRound, currentPlayRound, playRoundFor, playRoundsBetween } from "@/lib/time";
import { getAccount, maskEmail, type Reminders } from "./account";
import { getAiCall } from "./ai";
import { getCounts, getPicks, getResult, storeKind, type Mode } from "./store";
import { testMode } from "@/lib/play/testmode";

export const PLAY_COOKIE = "ns_play";
const UID = /^[0-9a-f-]{36}$/;

/** The player's id from their cookie (anonymous until they sign in), or null before their first pick. */
export const playerId = (req: NextRequest) => {
  const v = req.cookies.get(PLAY_COOKIE)?.value ?? "";
  return UID.test(v) ? v : null;
};
export const newPlayerId = () => randomUUID();
export function setPlayerCookie(res: NextResponse, uid: string | null) {
  res.cookies.set(PLAY_COOKIE, uid ?? "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: uid ? 400 * 86400 : 0 });
}

/**
 * The clock. In test mode (local, or a preview deployment with PLAY_TEST_MODE=1), tests may send `x-play-now: <ISO time>` to play a round at a chosen moment (lock
 * and settlement tests against real past prices). Production always uses the real time.
 */
export function playNow(req: NextRequest): { now: number; overridden: boolean } {
  const h = req.headers.get("x-play-now");
  if (h && testMode()) {
    const t = Date.parse(h);
    if (Number.isFinite(t)) return { now: t, overridden: true };
  }
  return { now: Date.now(), overridden: false };
}

export type PlayPick = { ticker: string; side: Side; result: PickResult; close?: number; open?: number; outcome?: string };
export type PlayHistoryRound = { mode: Mode; date: string; settleDate: string; status: "pending" | "settled" | "void"; picks: PlayPick[] };

/** A player's numbers across both games (shared by the page and the leaderboard). */
export type PlayerSummary = {
  close: PlayStats | null;
  ai: PlayStats | null;
  points: number;
  week: number; // points from rounds locking this New York week (Mon–Fri)
  history: PlayHistoryRound[];
};

type ResultCache = Map<string, Promise<RoundResult | null>>;
const cachedResult = (cache: ResultCache, mode: Mode, date: string) => {
  const k = `${mode}:${date}`;
  if (!cache.has(k)) cache.set(k, getResult(date, mode));
  return cache.get(k)!;
};

export async function playerSummary(uid: string, now: number, cache: ResultCache = new Map()): Promise<PlayerSummary> {
  const cur = currentPlayRound(now);
  const curAi = currentAiRound(now);
  const [picks, aiPicks] = await Promise.all([getPicks(uid, "close"), getPicks(uid, "ai")]);
  const history: PlayHistoryRound[] = [];
  const weekFrom = weekStart(cur.date);

  // up/down vs the close: every round from the first pick to now, so skipped rounds break the streak
  let close: PlayStats | null = null;
  const dates = Object.keys(picks).filter((d) => d <= cur.date).sort();
  if (dates.length) {
    const span = playRoundsBetween(dates[0], cur.date);
    const res = new Map(await Promise.all(span.filter((d) => d !== cur.date).map(async (d) => [d, await cachedResult(cache, "close", d)] as const)));
    close = playStats(span.map((d) => ({ date: d, picks: picks[d] ?? {}, result: res.get(d) ?? null, open: d === cur.date })));
    for (const d of dates.filter((x) => x !== cur.date)) history.push(historyRound("close", d, playRoundFor(d).settleDate, picks[d], res.get(d) ?? null));
  }

  // Beat the AI: only the rounds played (no streaks in this mode)
  let ai: PlayStats | null = null;
  const aiDates = Object.keys(aiPicks).filter((d) => d <= curAi.date).sort();
  if (aiDates.length) {
    const res = new Map(await Promise.all(aiDates.map(async (d) => [d, d === curAi.date && now < curAi.openMs ? null : await cachedResult(cache, "ai", d)] as const)));
    ai = playStats(aiDates.map((d) => ({ date: d, picks: aiPicks[d], result: res.get(d) ?? null })), { streakBonus: false });
    for (const d of aiDates.filter((x) => now >= aiRoundFor(x).lockMs)) history.push(historyRound("ai", d, d, aiPicks[d], res.get(d) ?? null));
  }

  const week = [close, ai].reduce((sum, s) => sum + Object.entries(s?.byRound ?? {}).filter(([d]) => d >= weekFrom).reduce((a, [, p]) => a + p, 0), 0);
  history.sort((a, b) => (a.settleDate < b.settleDate ? 1 : a.settleDate > b.settleDate ? -1 : a.mode === "ai" ? 1 : -1));
  return { close, ai, points: (close?.points ?? 0) + (ai?.points ?? 0), week, history: history.slice(0, 12) };
}

function historyRound(mode: Mode, date: string, settleDate: string, picks: Record<string, Side>, r: RoundResult | null): PlayHistoryRound {
  return {
    mode,
    date,
    settleDate,
    status: !r ? "pending" : r.status,
    picks: Object.entries(picks).map(([ticker, side]) => {
      const a = r?.status === "settled" ? r.assets[ticker] : undefined;
      return { ticker, side, result: scorePick(side, r, ticker), ...(a ? { close: a.close, open: a.open, outcome: a.outcome } : {}) };
    }),
  };
}

export type PlayState = {
  now: number;
  store: "redis" | "memory";
  assets: typeof PLAY_ASSETS;
  rules: { points: typeof POINTS; voidAfterHours: number };
  account: { nick: string; email: string; remind: Reminders } | null;
  round: { date: string; lockAt: number; settleDate: string; opensAt: number };
  myPicks: Record<string, Side>;
  crowd: Record<string, { up: number; down: number }>; // only for assets you've picked this round
  ai: {
    round: { date: string; callAt: number; lockAt: number; opensAt: number };
    open: boolean; // taking picks now
    call: Record<string, number> | null; // Nightshift's call (the strike), once taken
    myPicks: Record<string, Side>;
    crowd: Record<string, { up: number; down: number }>;
  };
  stats: PlayStats | null; // up/down vs the close
  aiStats: PlayStats | null;
  points: number; // both games
  week: number;
  history: PlayHistoryRound[];
};

export async function playState(uid: string | null, now: number): Promise<PlayState> {
  const cur = currentPlayRound(now);
  const curAi = currentAiRound(now);
  const call = await getAiCall(curAi.date);
  const aiOpen = !!call && now >= curAi.callMs && now < curAi.lockMs;
  const [summary, account, picks, aiPicks] = uid
    ? await Promise.all([playerSummary(uid, now), getAccount(uid), getPicks(uid, "close"), getPicks(uid, "ai")])
    : [null, null, {}, {}];
  const myPicks = (picks as Record<string, Record<string, Side>>)[cur.date] ?? {};
  const myAi = (aiPicks as Record<string, Record<string, Side>>)[curAi.date] ?? {};
  const crowdFor = async (mine: Record<string, Side>, date: string, mode: Mode) => {
    if (!Object.keys(mine).length) return {};
    const all = await getCounts(date, mode);
    return Object.fromEntries(Object.keys(mine).map((t) => [t, all[t] ?? { up: 0, down: 0 }]));
  };
  return {
    now,
    store: storeKind(),
    assets: PLAY_ASSETS,
    rules: { points: POINTS, voidAfterHours: VOID_AFTER_HOURS },
    account: account ? { nick: account.nick, email: maskEmail(account.email), remind: account.remind } : null,
    round: { date: cur.date, lockAt: cur.lockMs, settleDate: cur.settleDate, opensAt: cur.openMs },
    myPicks,
    crowd: await crowdFor(myPicks, cur.date, "close"),
    ai: {
      round: { date: curAi.date, callAt: curAi.callMs, lockAt: curAi.lockMs, opensAt: curAi.openMs },
      open: aiOpen,
      call: call && now >= curAi.callMs ? call.p : null,
      myPicks: myAi,
      crowd: await crowdFor(myAi, curAi.date, "ai"),
    },
    stats: summary?.close ?? null,
    aiStats: summary?.ai ?? null,
    points: summary?.points ?? 0,
    week: summary?.week ?? 0,
    history: summary?.history ?? [],
  };
}
