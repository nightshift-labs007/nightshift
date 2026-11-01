import type { PriceSource as PriceSourceKind } from "@nightshift-signals/core";

export type QuoteFailure = "no_pool" | "paused" | "reverted" | "unavailable";

export class QuoteError extends Error {
  constructor(
    readonly reason: QuoteFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface TokenRef {
  symbol: string;
  address: string;
  decimals: number;
  poolFee: number | null;
}

/** Executable DEX quotes. Amounts are decimal strings in whole units. */
export interface QuoteSource {
  buy(token: TokenRef, usdgIn: string): Promise<{ tokensOut: string }>;
  sell(token: TokenRef, tokensIn: string): Promise<{ usdgOut: string }>;
}

export interface Tick {
  symbol: string;
  px: string;
  src: PriceSourceKind;
  ts: Date;
}

/** Streaming prices for fair-value proxies (futures, BTC). */
export interface PriceSource {
  readonly symbols: string[];
  /** Returns a stop function. */
  start(onTick: (t: Tick) => void): () => void;
}

export interface RegistryEntry {
  symbol: string;
  address: string;
  underlying_ticker: string;
  name: string;
  decimals: number;
  pool_address: string | null;
  pool_fee: number | null;
  proxy: string | null;
  active: boolean;
}

/** The official Stock Token list plus pool depth. */
export interface RegistrySource {
  list(): Promise<RegistryEntry[]>;
  poolLiquidityUsdg(entry: RegistryEntry): Promise<string | null>;
}

/** Official ETF closing and opening prints (equities data vendor). */
export interface EquityPrintSource {
  close(ticker: string, date: string): Promise<string | null>;
  open(ticker: string, date: string): Promise<string | null>;
}
