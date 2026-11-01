import { z } from "zod";
import { BasketId } from "../ids";
import { Decimal, Timestamp } from "../primitives";

export const GradeLeg = z.object({
  token_symbol: z.string().min(1).max(32),
  entry_quote_price: Decimal,
  /** Token price at 9:45 ET. This is what the grade uses. */
  exit_price: Decimal,
  /** Underlying ETF's official opening print, recorded alongside for comparison. */
  exit_open_print: Decimal.nullable(),
  ret_pct: Decimal,
});
export type GradeLeg = z.infer<typeof GradeLeg>;

/**
 * r_leg = exit / entry_quote − 1 · r_basket = Σ w × r_leg · vs_spy = r_basket − r_SPY · hit = vs_spy > 0.
 * Returns are fractions (0.0123 = 1.23%) despite the `_pct` names, which follow the deck.
 */
export const Grade = z.object({
  basket_id: BasketId,
  graded_at: Timestamp,
  legs: z.array(GradeLeg).min(1),
  ret_pct: Decimal,
  spy_ret_pct: Decimal,
  /** SPY token prices at basket publish and at grade time, stored so anyone can recompute vs_spy. */
  spy_entry: Decimal,
  spy_exit: Decimal,
  vs_spy_pct: Decimal,
  hit: z.boolean(),
});
export type Grade = z.infer<typeof Grade>;
