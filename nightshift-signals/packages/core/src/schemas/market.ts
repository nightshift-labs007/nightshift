import { z } from "zod";
import { COMMIT_STATUSES, PRICE_SOURCES } from "../enums";
import { BasketId } from "../ids";
import { Address, Decimal, Hash32, Timestamp } from "../primitives";

/** Stock Token registry row. Eligible = active, liquid pool, and a fair-value proxy. */
export const Token = z.object({
  symbol: z.string().min(1).max(32),
  address: Address,
  underlying_ticker: z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/),
  name: z.string().max(200),
  decimals: z.number().int().min(0).max(36),
  pool_address: Address.nullable(),
  pool_liquidity_usdg: Decimal.nullable(),
  /** Fair-value proxy, e.g. `ES`, `NQ`, `GC`, `CL+ES`, `BTC`. */
  proxy: z.string().max(32).nullable(),
  beta: Decimal.nullable(),
  last_close: Decimal.nullable(),
  active: z.boolean(),
  eligible: z.boolean(),
  updated_at: Timestamp,
});
export type Token = z.infer<typeof Token>;

export const PriceBar1m = z.object({
  symbol: z.string().min(1).max(32),
  ts: Timestamp,
  o: Decimal,
  h: Decimal,
  l: Decimal,
  c: Decimal,
  source: z.enum(PRICE_SOURCES),
});
export type PriceBar1m = z.infer<typeof PriceBar1m>;

export const Commit = z.object({
  basket_id: BasketId,
  hash: Hash32,
  /** Null while pending (chain congested > 20 s); attached when it lands. */
  tx_hash: Hash32.nullable(),
  chain_id: z.number().int().positive(),
  block_number: z.number().int().nonnegative().nullable(),
  block_time: Timestamp.nullable(),
  status: z.enum(COMMIT_STATUSES),
  confirmed_at: Timestamp.nullable(),
});
export type Commit = z.infer<typeof Commit>;
