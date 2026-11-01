// Subset of the Nightshift Signals API shapes used by the app (see apps/api/src/schemas.ts).

export interface BasketSummary {
  id: string;
  thesis: string;
  thesis_i18n?: Record<string, string>;
  legs: { ticker: string; weight: number }[];
  confidence: number;
  status: "draft" | "published" | "graded" | "void";
  void_reason: string | null;
  published_at: string;
  simulated: boolean;
  grade: { ret_pct: string; vs_spy_pct: string; hit: boolean } | null;
}

export interface FeedItem {
  event: { id: string; title: string; category: string | null; severity: number | null; first_seen_at: string; sources_n: number };
  basket: BasketSummary | null;
}

export interface BasketDetail {
  basket: {
    id: string;
    thesis: string;
    why_chain: string[];
    status: BasketSummary["status"];
    legs: { token_symbol: string; underlying_ticker: string; weight: number; entry_quote_price: string }[];
    confidence: number;
  };
  event: { title: string } | null;
  commit: { hash: string; simulated: boolean } | null;
  grade: { ret_pct: string; vs_spy_pct: string; hit: boolean } | null;
  live: { token_symbol: string; underlying_ticker: string; mid: string | null; move_since_entry_pct: number | null }[];
}
