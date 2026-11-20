// Points game, "up or down vs last close": the rules, with no imports so Node's test runner can load them
// (test/play-rules.test.mjs). Shared by the API and the page.
//
// A round is named by its lock date D. Each pick says whether an asset's official OPEN on the next trading date
// will be above ("up") or below ("down") its official CLOSE on D. Points only, no money, no pools.

export const PLAY_ASSETS = [
  { ticker: "NVDA", name: "Nvidia" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "TSLA", name: "Tesla" },
  { ticker: "SPY", name: "S&P 500 (SPY)" },
  { ticker: "GLD", name: "Gold (GLD)" },
] as const;
export const PLAY_TICKERS: readonly string[] = PLAY_ASSETS.map((a) => a.ticker);

export type Side = "up" | "down";
export type Outcome = "up" | "down" | "flat";

/** Fixed rewards. A correct pick earns `correct`; a settled round you played while on a streak of `streakBonusFrom`+ rounds earns `streakBonus` once. Wrong picks cost nothing. */
export const POINTS = { correct: 10, streakBonus: 5, streakBonusFrom: 3 } as const;

/** How many hours after the open a round may wait for its prices before it's voided (no points, streak kept). */
export const VOID_AFTER_HOURS = 72;

export const cents = (usd: number) => Math.round(usd * 100);

/**
 * The flat rule: prices are compared to the cent (both rounded to the nearest $0.01). Open above the close → "up",
 * below → "down", the same cent → "flat". A flat result is a push: the pick neither wins nor loses.
 */
export function outcomeOf(close: number, open: number): Outcome {
  const c = cents(close);
  const o = cents(open);
  return o > c ? "up" : o < c ? "down" : "flat";
}

export type AssetResult = { close: number; open: number; outcome: Outcome };
export type RoundResult =
  | { date: string; status: "settled"; assets: Record<string, AssetResult>; settledAt: number }
  | { date: string; status: "void"; reason: string; settledAt: number };

export type PickResult = "win" | "loss" | "push" | "void" | "pending";

export function scorePick(side: Side, result: RoundResult | null | undefined, ticker: string): PickResult {
  if (!result) return "pending";
  if (result.status === "void") return "void";
  const a = result.assets[ticker];
  if (!a) return "void";
  if (a.outcome === "flat") return "push";
  return a.outcome === side ? "win" : "loss";
}

export const isSide = (x: unknown): x is Side => x === "up" || x === "down";

/** One round as a player saw it: their picks (maybe none) and the result once known. */
export type PlayedRound = { date: string; picks: Record<string, Side>; result: RoundResult | null; open?: boolean };

export type PlayStats = {
  points: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  accuracy: number | null; // wins / (wins + losses); pushes and voids don't count
  streak: number; // rounds played in a row, up to now
  bestStreak: number;
  byRound: Record<string, number>; // points earned in each settled round (for weekly totals)
};

/**
 * Stats from every round since the player's first pick, oldest first, ending with the round taking picks now
 * (`open: true`). Streak = consecutive rounds with at least one pick. A round you skipped resets it; the open round
 * only adds to it once you've picked (there's still time). Points come from settled rounds only.
 */
export function playStats(rounds: PlayedRound[], opts: { streakBonus?: boolean } = {}): PlayStats {
  const s: PlayStats = { points: 0, wins: 0, losses: 0, pushes: 0, pending: 0, accuracy: null, streak: 0, bestStreak: 0, byRound: {} };
  const bonusOn = opts.streakBonus !== false;
  let run = 0;
  for (const r of rounds) {
    const tickers = Object.keys(r.picks);
    if (!tickers.length) {
      if (!r.open) run = 0; // skipped a round that has locked: the streak breaks
      continue;
    }
    run += 1;
    s.bestStreak = Math.max(s.bestStreak, run);
    let settled = false;
    let earned = 0;
    for (const t of tickers) {
      const res = scorePick(r.picks[t], r.result, t);
      if (res === "win") (s.wins++, (earned += POINTS.correct));
      else if (res === "loss") s.losses++;
      else if (res === "push") s.pushes++;
      else if (res === "pending") s.pending++;
      if (res !== "pending" && res !== "void") settled = true;
    }
    if (settled && bonusOn && run >= POINTS.streakBonusFrom) earned += POINTS.streakBonus;
    if (settled) s.byRound[r.date] = earned;
    s.points += earned;
  }
  s.streak = run;
  s.accuracy = s.wins + s.losses ? s.wins / (s.wins + s.losses) : null;
  return s;
}

/** Monday of the New York week that contains `date` (YYYY-MM-DD), for weekly leaderboards. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type BoardRow = { nick: string; points: number; week: number; accuracy: number | null; streak: number; rounds: number };

/** Leaderboard order: points (for the chosen period), then accuracy, then rounds played, then nickname. */
export function rankBoard(rows: BoardRow[], by: "week" | "points"): BoardRow[] {
  return [...rows]
    .filter((r) => r[by] > 0 || r.rounds > 0)
    .sort((a, b) => b[by] - a[by] || (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.rounds - a.rounds || a.nick.localeCompare(b.nick));
}
