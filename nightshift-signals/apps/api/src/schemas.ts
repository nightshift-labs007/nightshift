import { z } from "@hono/zod-openapi";
import { BASKET_STATUSES, CATEGORIES } from "@nightshift-signals/core";

export const ErrorBody = z.object({ error: z.string() }).openapi("Error");

export const EventView = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.enum(CATEGORIES).nullable(),
    severity: z.number().int().nullable(),
    regions: z.array(z.string()),
    entities: z.array(z.string()),
    reason: z.string().nullable(),
    sources_n: z.number().int(),
    corroborated: z.boolean(),
    first_seen_at: z.string(),
    triaged_at: z.string().nullable(),
  })
  .openapi("Event");

export const BasketSummary = z
  .object({
    id: z.string(),
    thesis: z.string(),
    thesis_i18n: z.record(z.string(), z.string()),
    legs: z.array(z.object({ ticker: z.string(), weight: z.number() })),
    confidence: z.number(),
    status: z.enum(BASKET_STATUSES),
    void_reason: z.string().nullable(),
    published_at: z.string(),
    commit_tx: z.string().nullable(),
    simulated: z.boolean(),
    grade: z.object({ ret_pct: z.string(), vs_spy_pct: z.string(), hit: z.boolean() }).nullable(),
  })
  .openapi("BasketSummary");

export const FeedItem = z.object({ event: EventView, basket: BasketSummary.nullable() }).openapi("FeedItem");

export const Headline = z.object({ title: z.string(), url: z.string(), source: z.string(), received_at: z.string() });

export const LiveLeg = z
  .object({
    token_symbol: z.string(),
    underlying_ticker: z.string(),
    mid: z.string().nullable(),
    fair_value: z.string().nullable(),
    gap_bps: z.number().nullable(),
    frozen: z.boolean(),
    move_since_entry_pct: z.number().nullable(),
  })
  .openapi("LiveLeg");

export const QuoteLeg = z
  .object({
    token_symbol: z.string(),
    underlying_ticker: z.string(),
    usdg: z.string(),
    price: z.string().nullable(),
    slippage_bps: z.number().nullable(),
    over_cap: z.boolean(),
    error: z.string().nullable(),
  })
  .openapi("QuoteLeg");

export const TradeLink = z
  .object({ token_symbol: z.string(), underlying_ticker: z.string(), token_address: z.string(), usdg: z.string(), url: z.string().nullable() })
  .openapi("TradeLink");

export const Bucket = z.object({
  key: z.string(),
  n: z.number(),
  hit_rate: z.number().nullable(),
  mean_alpha: z.number().nullable(),
  mean_confidence: z.number().nullable(),
});

export const ScorecardSummary = z
  .object({
    graded: z.number(),
    voids: z.number(),
    hit_rate: z.number().nullable(),
    mean_ret: z.number().nullable(),
    mean_alpha: z.number().nullable(),
    median_alpha: z.number().nullable(),
    worst: z.object({ basket_id: z.string(), vs_spy_pct: z.number() }).nullable(),
    by_category: z.array(Bucket),
    by_confidence: z.array(Bucket),
  })
  .openapi("ScorecardSummary");

export const ScorecardRow = z
  .object({
    basket_id: z.string(),
    category: z.enum(CATEGORIES).nullable(),
    confidence: z.number(),
    published_at: z.string(),
    status: z.enum(["graded", "void"]),
    void_reason: z.string().nullable(),
    ret_pct: z.string().nullable(),
    vs_spy_pct: z.string().nullable(),
    hit: z.boolean().nullable(),
    thesis: z.string(),
    graded_at: z.string().nullable(),
  })
  .openapi("ScorecardRow");

export const FairValue = z
  .object({ symbol: z.string(), underlying: z.string(), mid: z.string(), fv: z.string(), gap_bps: z.number(), frozen: z.boolean(), as_of: z.string() })
  .openapi("FairValue");
