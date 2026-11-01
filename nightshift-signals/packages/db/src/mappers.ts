import { Basket } from "@nightshift-signals/core";
import type { baskets, basketLegs } from "./schema";

type BasketRow = typeof baskets.$inferSelect;
type BasketInsert = typeof baskets.$inferInsert;
type LegRow = typeof basketLegs.$inferSelect;
type LegInsert = typeof basketLegs.$inferInsert;

const toDate = (iso: string | null) => (iso === null ? null : new Date(iso));
const toIso = (d: Date | null) => (d === null ? null : d.toISOString());

export function basketToRows(b: Basket): { basket: BasketInsert; legs: LegInsert[] } {
  return {
    basket: {
      id: b.id,
      eventId: b.event_id,
      thesis: b.thesis,
      thesisI18n: b.thesis_i18n,
      whyChain: b.why_chain,
      direction: b.direction,
      confidence: b.confidence,
      confidenceCalibrated: b.confidence_calibrated,
      horizon: b.horizon,
      maxSlipBps: b.max_slip_bps,
      modelVersion: b.model_version,
      promptVersion: b.prompt_version,
      analogEventIds: b.analog_event_ids,
      canonicalHash: b.canonical_hash,
      commitTx: b.commit_tx,
      status: b.status,
      voidReason: b.void_reason,
      createdAt: new Date(b.created_at),
      publishedAt: toDate(b.published_at),
    },
    legs: b.legs.map((l, position) => ({
      basketId: b.id,
      position,
      tokenSymbol: l.token_symbol,
      tokenAddress: l.token_address,
      underlyingTicker: l.underlying_ticker,
      weight: String(l.weight),
      entryQuotePrice: l.entry_quote_price,
      entryQuoteSizeUsdg: l.entry_quote_size_usdg,
      estSlippageBps: l.est_slippage_bps,
      fairValue: l.fair_value,
      fvGapBps: l.fv_gap_bps,
    })),
  };
}

/** Rebuilds a validated core Basket; throws if the stored rows violate the schema. */
export function rowsToBasket(row: BasketRow, legs: LegRow[]): Basket {
  return Basket.parse({
    id: row.id,
    event_id: row.eventId,
    created_at: row.createdAt.toISOString(),
    published_at: toIso(row.publishedAt),
    thesis: row.thesis,
    thesis_i18n: row.thesisI18n,
    why_chain: row.whyChain,
    direction: row.direction,
    legs: [...legs]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        token_symbol: l.tokenSymbol,
        token_address: l.tokenAddress,
        underlying_ticker: l.underlyingTicker,
        weight: Number(l.weight),
        entry_quote_price: l.entryQuotePrice,
        entry_quote_size_usdg: l.entryQuoteSizeUsdg,
        est_slippage_bps: l.estSlippageBps,
        fair_value: l.fairValue,
        fv_gap_bps: l.fvGapBps,
      })),
    confidence: row.confidence,
    confidence_calibrated: row.confidenceCalibrated,
    horizon: row.horizon,
    max_slip_bps: row.maxSlipBps,
    model_version: row.modelVersion,
    prompt_version: row.promptVersion,
    analog_event_ids: row.analogEventIds,
    canonical_hash: row.canonicalHash,
    commit_tx: row.commitTx,
    status: row.status,
    void_reason: row.voidReason,
  });
}
