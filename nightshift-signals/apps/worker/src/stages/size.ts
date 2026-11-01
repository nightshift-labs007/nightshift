import { QuoteError } from "@nightshift-signals/adapters";
import { makeEvent, moveBps, normalizeWeights, slippageBps, unitPrice, type BasketLeg, type Envelope } from "@nightshift-signals/core";
import { basketLegs, baskets, basketToRows, desc, eq, events, tokens } from "@nightshift-signals/db";
import type { Deps } from "../deps";

export const SIZER = "sizer";

interface Dropped {
  underlying_ticker: string;
  reason: string;
}

/**
 * Quotes each leg at the reference size, drops illiquid, priced-in or unquotable legs, renormalizes,
 * and writes the draft basket. Fewer than two surviving legs voids it as illiquid (kept for the record).
 */
export async function onBasketProposed(deps: Deps, e: Envelope<"basket.proposed">): Promise<void> {
  const p = e.payload;
  const [already] = await deps.db.select({ id: baskets.id }).from(baskets).where(eq(baskets.id, p.basket_id));
  if (already) return;

  const [ev] = await deps.db.select({ category: events.category }).from(events).where(eq(events.id, p.event_id));
  const typicalMove = ev?.category ? deps.taxonomy().categories[ev.category].typical_move_bps : Infinity;
  const gaps = await deps.fairValue.gaps(p.legs.map((l) => l.underlying_ticker));
  const { refSizeUsdg, probeSizeUsdg, maxSlipBps } = deps.config;

  const kept: (BasketLeg & { weight: number })[] = [];
  const dropped: Dropped[] = [];
  for (const leg of p.legs) {
    const [t] = await deps.db
      .select()
      .from(tokens)
      .where(eq(tokens.underlyingTicker, leg.underlying_ticker))
      .orderBy(desc(tokens.poolLiquidityUsdg))
      .limit(1);
    if (!t?.eligible) {
      dropped.push({ underlying_ticker: leg.underlying_ticker, reason: "not_eligible" });
      continue;
    }
    const ref = { symbol: t.symbol, address: t.address, decimals: t.decimals, poolFee: t.poolFee };
    try {
      const [probe, sized] = await Promise.all([deps.quotes.buy(ref, probeSizeUsdg), deps.quotes.buy(ref, refSizeUsdg)]);
      const mid = unitPrice(probeSizeUsdg, probe.tokensOut);
      const entry = unitPrice(refSizeUsdg, sized.tokensOut);
      const slip = slippageBps(entry, mid);
      if (t.lastClose && moveBps(mid, t.lastClose) >= typicalMove) {
        dropped.push({ underlying_ticker: leg.underlying_ticker, reason: "priced_in" });
        continue;
      }
      if (slip > maxSlipBps) {
        dropped.push({ underlying_ticker: leg.underlying_ticker, reason: `slippage_${slip}bps` });
        continue;
      }
      const gap = gaps.get(leg.underlying_ticker);
      kept.push({
        token_symbol: t.symbol,
        token_address: t.address,
        underlying_ticker: t.underlyingTicker,
        weight: leg.weight,
        entry_quote_price: entry,
        entry_quote_size_usdg: refSizeUsdg,
        est_slippage_bps: slip,
        fair_value: gap?.fv ?? mid,
        fv_gap_bps: gap?.gap_bps ?? 0,
      });
    } catch (err) {
      const reason = err instanceof QuoteError ? err.reason : "quote_failed";
      dropped.push({ underlying_ticker: leg.underlying_ticker, reason });
    }
  }

  const voided = kept.length < 2;
  const legs = voided ? kept : normalizeWeights(kept);
  const rows = basketToRows({
    id: p.basket_id,
    event_id: p.event_id,
    created_at: p.created_at,
    published_at: null,
    thesis: p.thesis,
    thesis_i18n: {},
    why_chain: p.why_chain,
    direction: "long",
    legs,
    confidence: p.confidence,
    confidence_calibrated: null,
    horizon: "next_open",
    max_slip_bps: maxSlipBps,
    model_version: p.model_version,
    prompt_version: p.prompt_version,
    analog_event_ids: p.analog_event_ids,
    canonical_hash: null,
    commit_tx: null,
    status: voided ? "void" : "draft",
    void_reason: voided ? "illiquid" : null,
  });

  const inserted = await deps.db.transaction(async (tx) => {
    const r = await tx.insert(baskets).values(rows.basket).onConflictDoNothing().returning({ id: baskets.id });
    if (r.length && rows.legs.length) await tx.insert(basketLegs).values(rows.legs);
    return r.length > 0;
  });
  if (!inserted) return;

  await deps.bus.publish(
    makeEvent(
      "basket.sized",
      {
        basket_id: p.basket_id,
        event_id: p.event_id,
        voided,
        void_reason: voided ? "illiquid" : null,
        max_leg_slip_bps: legs.length ? Math.max(...legs.map((l) => l.est_slippage_bps)) : null,
        dropped,
      },
      { producer: SIZER, correlation_id: p.event_id, now: deps.now() },
    ),
  );
}
