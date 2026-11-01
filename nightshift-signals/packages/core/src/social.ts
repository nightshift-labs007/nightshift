import Big from "big.js";
import { addDays, etParts, etToUtc } from "./market";
import type { Vote } from "./enums";
import { RETURN_DECIMALS } from "./grading";

// Follow or fade: users vote before the open; the crowd is graded exactly like the AI.

export const VOTE_WINDOW_MS = 30 * 60 * 1000;

export function voteOpen(publishedAt: Date, now: Date): boolean {
  return now.getTime() - publishedAt.getTime() <= VOTE_WINDOW_MS;
}

export interface CrowdTally {
  follow: number;
  fade: number;
  /** Majority call; null on a tie or no votes. */
  call: Vote | null;
}

export function tally(votes: Vote[]): CrowdTally {
  const follow = votes.filter((v) => v === "follow").length;
  const fade = votes.length - follow;
  return { follow, fade, call: follow > fade ? "follow" : fade > follow ? "fade" : null };
}

/** Following hits when the basket beats SPY; fading hits when it doesn't. */
export function crowdHit(call: Vote | null, basketHit: boolean): boolean | null {
  return call === null ? null : call === "follow" ? basketHit : !basketHit;
}

// Paper league: no money and no prizes with monetary value; a weekly leaderboard of paper results.

export interface EntryInput {
  token_symbol: string;
  quote_price: string;
  quote_size_usdg: string;
}

/** Grades a paper position on the user's own logged quotes against the basket's 9:45 ET exits. */
export function gradePosition(entries: EntryInput[], exits: Map<string, string>, spyRetPct: string) {
  let size = new Big(0);
  let pnl = new Big(0);
  for (const e of entries) {
    const exit = exits.get(e.token_symbol);
    if (!exit) continue;
    size = size.plus(e.quote_size_usdg);
    pnl = pnl.plus(new Big(e.quote_size_usdg).times(new Big(exit).div(e.quote_price).minus(1)));
  }
  if (size.eq(0)) return null;
  const ret = pnl.div(size);
  return {
    ret_pct: ret.toFixed(RETURN_DECIMALS),
    vs_spy_pct: ret.minus(spyRetPct).toFixed(RETURN_DECIMALS),
    pnl_usdg: pnl.toFixed(18),
  };
}

/** League weeks run Monday 00:00 to Monday 00:00, New York time. */
export function leagueWeek(at: Date): { start: Date; end: Date; label: string } {
  const p = etParts(at);
  const monday = addDays(p.date, -((p.weekday + 6) % 7));
  return { start: etToUtc(monday, 0, 0), end: etToUtc(addDays(monday, 7), 0, 0), label: monday };
}

export interface LeaguePosition {
  user_id: string;
  graded_at: Date;
  pnl_usdg: string;
  vs_spy_pct: string;
}

export interface LeagueRow {
  user_id: string;
  pnl_usdg: number;
  positions: number;
  beat_spy: number;
  /** Consecutive most recent positions that beat SPY. */
  streak: number;
  badges: string[];
}

export const BADGES: { id: string; label: string; earned: (r: Omit<LeagueRow, "badges">) => boolean }[] = [
  { id: "first_receipt", label: "First receipt", earned: (r) => r.positions >= 1 },
  { id: "hot_hand", label: "Three in a row", earned: (r) => r.streak >= 3 },
  { id: "beat_five", label: "Beat SPY five times", earned: (r) => r.beat_spy >= 5 },
  { id: "regular", label: "Ten nights", earned: (r) => r.positions >= 10 },
];

export function leaderboard(positions: LeaguePosition[]): LeagueRow[] {
  const byUser = Map.groupBy(positions, (p) => p.user_id);
  const rows = [...byUser].map(([user_id, ps]) => {
    const sorted = [...ps].sort((a, b) => b.graded_at.getTime() - a.graded_at.getTime());
    let streak = 0;
    for (const p of sorted) {
      if (Number(p.vs_spy_pct) > 0) streak++;
      else break;
    }
    const base = {
      user_id,
      pnl_usdg: Number(ps.reduce((s, p) => s.plus(p.pnl_usdg), new Big(0)).toFixed(2)),
      positions: ps.length,
      beat_spy: ps.filter((p) => Number(p.vs_spy_pct) > 0).length,
      streak,
    };
    return { ...base, badges: BADGES.filter((b) => b.earned(base)).map((b) => b.id) };
  });
  return rows.sort((a, b) => b.pnl_usdg - a.pnl_usdg || b.beat_spy - a.beat_spy);
}
