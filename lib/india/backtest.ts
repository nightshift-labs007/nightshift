import "server-only";
import type { DailyBar, Series, SeriesKey } from "./data";

/**
 * India research engine. Everything is derived from price history, never from hand-typed event dates:
 *  1. a pre-open estimate of the Nifty 50's opening gap from overnight drivers, fitted walk-forward (past data only)
 *     and graded against the real open and against a "no change" guess;
 *  2. condition studies: on days when an overnight condition held (a US sell-off, an oil shock, rupee stress…),
 *     what the Nifty did next, compared with an ordinary day.
 * Findings are historical statistics, not recommendations.
 */

const DRIVERS = ["spx", "crude", "gold", "usdinr"] as const;
type Driver = (typeof DRIVERS)[number];

export type Day = {
  date: string;
  prevClose: number;
  open: number;
  close: number;
  gap: number; // open vs previous close
  day: number; // close vs previous close
  week: number | null; // close 4 sessions later vs previous close
  f: Record<Driver | "vix" | "niftyPrev", number | null>; // what was known before the open
};

export type Condition = {
  id: string;
  name: string;
  family: "geopolitical" | "global" | "currency" | "fear" | "momentum";
  rule: string;
  why: string;
  test: (f: Day["f"]) => boolean | null;
};

export const CONDITIONS: Condition[] = [
  { id: "us-selloff", name: "US sell-off overnight", family: "global", rule: "S&P 500 fell 1.5% or more since the last Nifty close", why: "Foreign investors often trim emerging markets after a US sell-off.", test: (f) => (f.spx === null ? null : f.spx <= -0.015) },
  { id: "us-rally", name: "US rally overnight", family: "global", rule: "S&P 500 rose 1.5% or more since the last Nifty close", why: "Risk appetite tends to travel from New York to Asia.", test: (f) => (f.spx === null ? null : f.spx >= 0.015) },
  { id: "oil-shock", name: "Oil shock", family: "geopolitical", rule: "Crude oil jumped 4% or more", why: "India imports most of its oil; sudden spikes, often from Middle East tension, hit the rupee and margins.", test: (f) => (f.crude === null ? null : f.crude >= 0.04) },
  { id: "oil-drop", name: "Oil slump", family: "geopolitical", rule: "Crude oil fell 4% or more", why: "Cheaper oil eases India's import bill and inflation.", test: (f) => (f.crude === null ? null : f.crude <= -0.04) },
  { id: "flight-to-safety", name: "Flight to safety", family: "geopolitical", rule: "Gold rose 1.5% or more while the S&P 500 fell", why: "Gold up with stocks down is the classic signature of a geopolitical scare.", test: (f) => (f.gold === null || f.spx === null ? null : f.gold >= 0.015 && f.spx < 0) },
  { id: "rupee-stress", name: "Rupee under pressure", family: "currency", rule: "USD/INR rose 0.4% or more", why: "A weaker rupee usually means foreign money leaving Indian equities.", test: (f) => (f.usdinr === null ? null : f.usdinr >= 0.004) },
  { id: "vix-spike", name: "Fear spike", family: "fear", rule: "India VIX jumped 12% or more in the last session", why: "A jump in expected volatility often follows or precedes sharp moves.", test: (f) => (f.vix === null ? null : f.vix >= 0.12) },
  { id: "nifty-drop", name: "After a big Nifty fall", family: "momentum", rule: "The Nifty fell 1.5% or more in the last session", why: "Tests whether sharp falls tend to extend or bounce.", test: (f) => (f.niftyPrev === null ? null : f.niftyPrev <= -0.015) },
];

/** Close of the last bar strictly before `date` (binary search over date-sorted bars). */
function idxBefore(bars: DailyBar[], date: string): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date < date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** A driver's move between two Nifty sessions: its last close before `date` vs its last close before `prevDate`. */
function moveBetween(s: Series | undefined, prevDate: string, date: string): number | null {
  if (!s) return null;
  const a = idxBefore(s.bars, date), b = idxBefore(s.bars, prevDate);
  if (a < 0 || b < 0 || a === b) return a >= 0 && a === b ? 0 : null;
  return s.bars[a].c / s.bars[b].c - 1;
}

export function buildDays(data: Partial<Record<SeriesKey, Series>>): Day[] {
  const n = data.nifty?.bars ?? [];
  const days: Day[] = [];
  for (let i = 2; i < n.length; i++) {
    const [p2, p, d] = [n[i - 2], n[i - 1], n[i]];
    const f = Object.fromEntries(DRIVERS.map((k) => [k, moveBetween(data[k], p.date, d.date)])) as Day["f"];
    const vi = data.vix ? idxBefore(data.vix.bars, d.date) : -1;
    f.vix = vi > 0 ? data.vix!.bars[vi].c / data.vix!.bars[vi - 1].c - 1 : null;
    f.niftyPrev = p.c / p2.c - 1;
    days.push({ date: d.date, prevClose: p.c, open: d.o, close: d.c, gap: d.o / p.c - 1, day: d.c / p.c - 1, week: n[i + 4] ? n[i + 4].c / p.c - 1 : null, f });
  }
  return days;
}

/** Features for the next Nifty session: what has happened since the last close. */
export function nextSessionFeatures(data: Partial<Record<SeriesKey, Series>>): { after: string; f: Day["f"] } | null {
  const n = data.nifty?.bars ?? [];
  if (n.length < 2) return null;
  const last = n[n.length - 1];
  const future = "9999-12-31";
  const f = Object.fromEntries(DRIVERS.map((k) => [k, moveBetween(data[k], last.date, future)])) as Day["f"];
  const vb = data.vix?.bars ?? [];
  f.vix = vb.length > 1 ? vb[vb.length - 1].c / vb[vb.length - 2].c - 1 : null;
  f.niftyPrev = last.c / n[n.length - 2].c - 1;
  return { after: last.date, f };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

export type Study = {
  id: string;
  name: string;
  family: Condition["family"];
  rule: string;
  why: string;
  events: number;
  avgGap: number;
  avgDay: number;
  /** close vs open: what happened after the opening bell */
  avgIntraday: number;
  avgWeek: number | null;
  downDayPct: number;
  /** vs an ordinary day: how unusual the next-day move is, in standard errors */
  t: number;
  strength: "strong" | "moderate" | "weak" | "too few";
  recent: { date: string; day: number }[];
};

export type Baseline = { days: number; avgDay: number; downDayPct: number; from: string; to: string };

export function studyConditions(days: Day[]): { baseline: Baseline; studies: Study[] } {
  const all = days.map((d) => d.day);
  const base = mean(all), spread = sd(all);
  const baseline = { days: days.length, avgDay: base, downDayPct: all.filter((x) => x < 0).length / all.length, from: days[0]?.date ?? "", to: days[days.length - 1]?.date ?? "" };
  const studies = CONDITIONS.map((c) => {
    const ev = days.filter((d) => c.test(d.f) === true);
    const dayMoves = ev.map((d) => d.day);
    const weeks = ev.flatMap((d) => (d.week === null ? [] : [d.week]));
    const t = ev.length ? (mean(dayMoves) - base) / (spread / Math.sqrt(ev.length)) : 0;
    const strength: Study["strength"] = ev.length < 8 ? "too few" : Math.abs(t) >= 2.5 ? "strong" : Math.abs(t) >= 1.5 ? "moderate" : "weak";
    return {
      id: c.id, name: c.name, family: c.family, rule: c.rule, why: c.why,
      events: ev.length,
      avgGap: mean(ev.map((d) => d.gap)),
      avgDay: mean(dayMoves),
      avgIntraday: mean(ev.map((d) => d.close / d.open - 1)),
      avgWeek: weeks.length ? mean(weeks) : null,
      downDayPct: ev.length ? dayMoves.filter((x) => x < 0).length / ev.length : 0,
      t, strength,
      recent: ev.slice(-5).reverse().map((d) => ({ date: d.date, day: d.day })),
    };
  });
  return { baseline, studies };
}

/** Ordinary least squares with an intercept, by normal equations (small k, so Gaussian elimination is fine). */
function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0].length + 1;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((row, i) => {
    const r = [1, ...row];
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += r[a] * r[b];
      A[a][k] += r[a] * y[i];
    }
  });
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const m = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= m * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

export type Estimate = {
  coefficients: Record<"intercept" | Driver, number>;
  graded: { date: string; predicted: number; actual: number }[];
  maeBps: number;
  naiveMaeBps: number;
  directionHit: number; // share of opens where the predicted direction was right (opens that moved more than 0.1%)
  next: { after: string; gap: number; level: number; drivers: Record<Driver, number | null> } | null;
};

const WINDOW = 250; // ~1 trading year of history for each fit
const MIN_FIT = 120;
const featureRow = (f: Day["f"]) => DRIVERS.map((k) => f[k] ?? 0);

/** Walk-forward: each day's gap is predicted by a model fitted only on the days before it. */
export function preOpenEstimate(days: Day[], next: ReturnType<typeof nextSessionFeatures>, gradeDays = 250): Estimate | null {
  const usable = days.filter((d) => DRIVERS.every((k) => d.f[k] !== null));
  if (usable.length < MIN_FIT + 20) return null;
  const graded: Estimate["graded"] = [];
  for (let i = Math.max(MIN_FIT, usable.length - gradeDays); i < usable.length; i++) {
    const train = usable.slice(Math.max(0, i - WINDOW), i);
    const beta = ols(train.map((d) => featureRow(d.f)), train.map((d) => d.gap));
    if (!beta) continue;
    const x = featureRow(usable[i].f);
    graded.push({ date: usable[i].date, predicted: beta[0] + x.reduce((a, v, j) => a + v * beta[j + 1], 0), actual: usable[i].gap });
  }
  const train = usable.slice(-WINDOW);
  const beta = ols(train.map((d) => featureRow(d.f)), train.map((d) => d.gap));
  if (!beta || !graded.length) return null;
  const moved = graded.filter((g) => Math.abs(g.actual) > 0.001);
  let nextOut: Estimate["next"] = null;
  if (next && DRIVERS.every((k) => next.f[k] !== null)) {
    const gap = beta[0] + featureRow(next.f).reduce((a, v, j) => a + v * beta[j + 1], 0);
    const lastClose = days[days.length - 1]?.close ?? 0;
    nextOut = { after: next.after, gap, level: lastClose * (1 + gap), drivers: Object.fromEntries(DRIVERS.map((k) => [k, next.f[k]])) as Record<Driver, number | null> };
  }
  return {
    coefficients: { intercept: beta[0], spx: beta[1], crude: beta[2], gold: beta[3], usdinr: beta[4] },
    graded: graded.slice(-15).reverse(),
    maeBps: mean(graded.map((g) => Math.abs(g.predicted - g.actual))) * 1e4,
    naiveMaeBps: mean(graded.map((g) => Math.abs(g.actual))) * 1e4,
    directionHit: moved.filter((g) => Math.sign(g.predicted) === Math.sign(g.actual)).length / Math.max(1, moved.length),
    next: nextOut,
  };
}
