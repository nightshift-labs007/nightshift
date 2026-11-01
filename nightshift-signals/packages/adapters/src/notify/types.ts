import type { Category, DeliveryChannel } from "@nightshift-signals/core";

export interface BasketAlert {
  basket_id: string;
  url: string;
  headline: string;
  thesis: string;
  /** Translations by language code; English is `thesis`. */
  thesis_i18n: Record<string, string>;
  severity: number;
  category: Category | null;
  legs: { ticker: string; weight: number }[];
  confidence: number;
  canonical_hash: string;
  commit_tx: string | null;
  /** Chain congested: published with the signed hash, tx attached when it lands. */
  commit_pending: boolean;
  simulated: boolean;
}

export interface ScorecardPost {
  date: string;
  url: string;
  graded: { basket_id: string; thesis: string; ret_pct: string; vs_spy_pct: string; hit: boolean }[];
  voids: { basket_id: string; reason: string }[];
  hit_rate: number | null;
}

/** A broadcast channel. Every channel receives a basket at the same moment; there is no early tier. */
export interface Notifier {
  readonly channel: DeliveryChannel;
  publishBasket(alert: BasketAlert): Promise<void>;
  publishScorecard(post: ScorecardPost): Promise<void>;
}
