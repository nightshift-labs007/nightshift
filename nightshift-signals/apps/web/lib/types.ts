// Shapes returned by the Nightshift Signals API (apps/api/src/schemas.ts).
import type { Basket, BasketStatus, Category } from "@nightshift-signals/core";

export interface EventView {
  id: string;
  title: string;
  category: Category | null;
  severity: number | null;
  regions: string[];
  entities: string[];
  reason: string | null;
  sources_n: number;
  corroborated: boolean;
  first_seen_at: string;
  triaged_at: string | null;
}

export interface BasketSummary {
  id: string;
  thesis: string;
  thesis_i18n?: Record<string, string>;
  legs: { ticker: string; weight: number }[];
  confidence: number;
  status: BasketStatus;
  void_reason: string | null;
  published_at: string;
  commit_tx: string | null;
  simulated: boolean;
  grade: { ret_pct: string; vs_spy_pct: string; hit: boolean } | null;
}

export interface FeedItem {
  event: EventView;
  basket: BasketSummary | null;
}

export interface Headline {
  title: string;
  url: string;
  source: string;
  received_at: string;
}

export interface LiveLeg {
  token_symbol: string;
  underlying_ticker: string;
  mid: string | null;
  fair_value: string | null;
  gap_bps: number | null;
  frozen: boolean;
  move_since_entry_pct: number | null;
}

export interface Commit {
  hash: string;
  tx_hash: string | null;
  chain_id: number;
  status: "pending" | "confirmed";
  block_number: number | null;
  block_time: string | null;
  simulated: boolean;
}

export interface Grade {
  graded_at: string;
  legs: { token_symbol: string; entry_quote_price: string; exit_price: string; exit_open_print: string | null; ret_pct: string }[];
  ret_pct: string;
  spy_ret_pct: string;
  vs_spy_pct: string;
  spy_entry: string;
  spy_exit: string;
  hit: boolean;
}

export interface BasketDetail {
  basket: Basket;
  why_chain_i18n: Record<string, string[]>;
  event: EventView | null;
  headlines: Headline[];
  commit: Commit | null;
  grade: Grade | null;
  analogs: FeedItem[];
  live: LiveLeg[];
}

export interface QuoteLeg {
  token_symbol: string;
  underlying_ticker: string;
  usdg: string;
  price: string | null;
  slippage_bps: number | null;
  over_cap: boolean;
  error: string | null;
}

export interface Bucket {
  key: string;
  n: number;
  hit_rate: number | null;
  mean_alpha: number | null;
  mean_confidence: number | null;
}

export interface ScorecardSummary {
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

export interface ScorecardRow {
  basket_id: string;
  category: Category | null;
  confidence: number;
  published_at: string;
  status: "graded" | "void";
  void_reason: string | null;
  ret_pct: string | null;
  vs_spy_pct: string | null;
  hit: boolean | null;
  thesis: string;
  graded_at: string | null;
}

export interface FairValue {
  symbol: string;
  underlying: string;
  mid: string;
  fv: string;
  gap_bps: number;
  frozen: boolean;
  as_of: string;
}
