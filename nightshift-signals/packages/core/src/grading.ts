import Big from "big.js";
import type { Category } from "./enums";
import type { GradeLeg } from "./schemas/grade";

// Returns are fractions (0.0123 = 1.23%), as fixed-decimal strings.
// r_leg = exit / entry_quote − 1 · r_basket = Σ w × r_leg · vs_spy = r_basket − r_SPY · hit = vs_spy > 0
export const RETURN_DECIMALS = 10;

export interface GradeLegInput {
  token_symbol: string;
  weight: number;
  entry_quote_price: string;
  exit_price: string;
  exit_open_print: string | null;
}

export function gradeBasket(legs: GradeLegInput[], spy: { entry: string; exit: string }) {
  const graded: GradeLeg[] = legs.map((l) => ({
    token_symbol: l.token_symbol,
    entry_quote_price: l.entry_quote_price,
    exit_price: l.exit_price,
    exit_open_print: l.exit_open_print,
    ret_pct: new Big(l.exit_price).div(l.entry_quote_price).minus(1).toFixed(RETURN_DECIMALS),
  }));
  const ret = legs.reduce((s, l, i) => s.plus(new Big(l.weight.toFixed(6)).times(graded[i]!.ret_pct)), new Big(0));
  const spyRet = new Big(spy.exit).div(spy.entry).minus(1);
  const alpha = ret.minus(spyRet);
  return {
    legs: graded,
    ret_pct: ret.toFixed(RETURN_DECIMALS),
    spy_ret_pct: spyRet.toFixed(RETURN_DECIMALS),
    vs_spy_pct: alpha.toFixed(RETURN_DECIMALS),
    hit: alpha.gt(0),
  };
}

export interface ScoreRow {
  basket_id: string;
  category: Category | null;
  confidence: number;
  published_at: string;
  status: "graded" | "void";
  void_reason: string | null;
  ret_pct: string | null;
  vs_spy_pct: string | null;
  hit: boolean | null;
}

export interface Bucket {
  key: string;
  n: number;
  hit_rate: number | null;
  mean_alpha: number | null;
  mean_confidence: number | null;
}

export interface Scorecard {
  graded: number;
  voids: number;
  hit_rate: number | null;
  mean_ret: number | null;
  mean_alpha: number | null;
  median_alpha: number | null;
  worst: { basket_id: string; vs_spy_pct: number } | null;
  by_category: Bucket[];
  by_confidence: Bucket[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function bucket(key: string, rows: ScoreRow[]): Bucket {
  const g = rows.filter((r) => r.status === "graded");
  return {
    key,
    n: g.length,
    hit_rate: g.length ? g.filter((r) => r.hit).length / g.length : null,
    mean_alpha: mean(g.map((r) => Number(r.vs_spy_pct))),
    mean_confidence: mean(g.map((r) => r.confidence)),
  };
}

/** Misses count exactly like wins; voids are counted and listed, never dropped. */
export function computeScorecard(rows: ScoreRow[]): Scorecard {
  const graded = rows.filter((r) => r.status === "graded");
  const alphas = graded.map((r) => Number(r.vs_spy_pct));
  const worst = graded.reduce<ScoreRow | null>((w, r) => (!w || Number(r.vs_spy_pct) < Number(w.vs_spy_pct) ? r : w), null);

  const cats = [...new Set(graded.map((r) => r.category ?? "other"))].sort();
  const confBuckets = ["0.0-0.4", "0.4-0.5", "0.5-0.6", "0.6-0.7", "0.7-1.0"];
  const inBucket = (c: number, key: string) => {
    const [lo, hi] = key.split("-").map(Number) as [number, number];
    return c >= lo && (c < hi || (hi === 1 && c <= 1));
  };

  return {
    graded: graded.length,
    voids: rows.filter((r) => r.status === "void").length,
    hit_rate: graded.length ? graded.filter((r) => r.hit).length / graded.length : null,
    mean_ret: mean(graded.map((r) => Number(r.ret_pct))),
    mean_alpha: mean(alphas),
    median_alpha: median(alphas),
    worst: worst ? { basket_id: worst.basket_id, vs_spy_pct: Number(worst.vs_spy_pct) } : null,
    by_category: cats.map((c) => bucket(c, graded.filter((r) => (r.category ?? "other") === c))),
    by_confidence: confBuckets.map((k) => bucket(k, graded.filter((r) => inBucket(r.confidence, k)))),
  };
}

export interface CsvLeg {
  basket_id: string;
  published_at: string;
  category: string;
  confidence: number;
  status: string;
  void_reason: string;
  canonical_hash: string;
  commit_tx: string;
  token_symbol: string;
  weight: number;
  entry_quote_price: string;
  exit_price: string;
  spy_entry: string;
  spy_exit: string;
  ret_pct: string;
  vs_spy_pct: string;
  hit: string;
}

export const CSV_COLUMNS: (keyof CsvLeg)[] = [
  "basket_id", "published_at", "category", "confidence", "status", "void_reason", "canonical_hash", "commit_tx",
  "token_symbol", "weight", "entry_quote_price", "exit_price", "spy_entry", "spy_exit", "ret_pct", "vs_spy_pct", "hit",
];

/** One row per leg: everything needed to recompute every grade with scripts/recompute-scorecard.ts. */
export function scorecardCsv(rows: CsvLeg[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}
