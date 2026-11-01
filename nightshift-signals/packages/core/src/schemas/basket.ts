import { z } from "zod";
import { BASKET_STATUSES, DIRECTIONS, HORIZONS, VOID_REASONS } from "../enums";
import { BasketId, EventId } from "../ids";
import { Address, Bps, Decimal, Hash32, Lang, Timestamp } from "../primitives";

export const MIN_LEGS = 2;
export const MAX_LEGS = 4;
export const MAX_LEG_WEIGHT = 0.5;
export const THESIS_MAX = 240;
/** Translations may run longer than English in some scripts. */
export const THESIS_I18N_MAX = 480;
export const WHY_STEP_MAX = 80;
const WEIGHT_SUM_TOLERANCE = 1e-6;

export const BasketLeg = z.object({
  token_symbol: z.string().min(1).max(32),
  token_address: Address,
  underlying_ticker: z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/),
  weight: z.number().gt(0).max(MAX_LEG_WEIGHT),
  /** Executable quote in USDG per token at publish time; what the grader uses as entry. */
  entry_quote_price: Decimal,
  /** Reference size the quote was taken at, published so slippage is honest. */
  entry_quote_size_usdg: Decimal,
  est_slippage_bps: Bps.min(0),
  fair_value: Decimal,
  fv_gap_bps: Bps,
});
export type BasketLeg = z.infer<typeof BasketLeg>;

export const Basket = z
  .object({
    id: BasketId,
    event_id: EventId,
    created_at: Timestamp,
    published_at: Timestamp.nullable(),
    thesis: z.string().min(1).max(THESIS_MAX),
    thesis_i18n: z.record(Lang, z.string().min(1).max(THESIS_I18N_MAX)),
    /** Why-graph: 2-4 short causal steps from headline to sectors. Empty when the model gave none. */
    why_chain: z.array(z.string().min(1).max(WHY_STEP_MAX)).max(4).default([]),
    direction: z.enum(DIRECTIONS),
    /** 2-4 legs, except a basket voided at sizing keeps whatever legs it had (possibly fewer). */
    legs: z.array(BasketLeg).max(MAX_LEGS),
    confidence: z.number().min(0).max(1),
    confidence_calibrated: z.number().min(0).max(1).nullable(),
    horizon: z.enum(HORIZONS),
    max_slip_bps: Bps.min(0),
    model_version: z.string().min(1),
    prompt_version: z.string().min(1),
    analog_event_ids: z.array(EventId).max(10),
    canonical_hash: Hash32.nullable(),
    commit_tx: Hash32.nullable(),
    status: z.enum(BASKET_STATUSES),
    void_reason: z.enum(VOID_REASONS).nullable(),
  })
  .superRefine((b, ctx) => {
    if ((b.status === "void") !== (b.void_reason !== null)) {
      ctx.addIssue({ code: "custom", path: ["void_reason"], message: "void_reason is set if and only if status is void" });
    }
    // A basket voided before commit is kept for the record, but its legs need not be tradeable.
    if (b.status === "void" && b.canonical_hash === null) return;
    if (b.legs.length < MIN_LEGS) {
      ctx.addIssue({ code: "custom", path: ["legs"], message: `basket needs at least ${MIN_LEGS} legs` });
    }
    const symbols = b.legs.map((l) => l.token_symbol);
    if (new Set(symbols).size !== symbols.length) {
      ctx.addIssue({ code: "custom", path: ["legs"], message: "duplicate token in legs" });
    }
    const sum = b.legs.reduce((s, l) => s + l.weight, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({ code: "custom", path: ["legs"], message: `weights must sum to 1, got ${sum}` });
    }
    for (const leg of b.legs) {
      if (leg.est_slippage_bps > b.max_slip_bps) {
        ctx.addIssue({ code: "custom", path: ["legs"], message: `${leg.token_symbol} slippage exceeds max_slip_bps` });
      }
    }
    // Commit before you show: nothing is published without a hash.
    if ((b.status === "published" || b.status === "graded") && (!b.canonical_hash || !b.published_at)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: `${b.status} basket needs canonical_hash and published_at` });
    }
  });
export type Basket = z.infer<typeof Basket>;
