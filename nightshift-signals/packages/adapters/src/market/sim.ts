import { QuoteError, type PriceSource, type QuoteSource, type RegistryEntry, type RegistrySource, type Tick, type TokenRef } from "./types";

/**
 * A deterministic simulated market for `pnpm dev:local` and tests: random-walk prices, quotes whose
 * price impact grows with size / pool depth. Addresses are placeholders, never real contracts.
 */
export class SimMarket implements QuoteSource, RegistrySource, PriceSource {
  readonly prices = new Map<string, number>();
  readonly liquidity = new Map<string, number>();
  /** Symbols whose pool is paused: quotes throw QuoteError("paused"). */
  readonly paused = new Set<string>();
  private seed = 42;

  constructor(
    private entries: (RegistryEntry & { price: number; liquidity: number })[],
    proxies: Record<string, number> = { ES: 6800, NQ: 25000, CL: 72, GC: 4100, BTC: 108000 },
  ) {
    for (const e of entries) {
      this.prices.set(e.symbol, e.price);
      this.liquidity.set(e.symbol, e.liquidity);
    }
    for (const [s, p] of Object.entries(proxies)) this.prices.set(s, p);
  }

  get symbols() {
    return [...this.prices.keys()].filter((s) => !this.entries.some((e) => e.symbol === s));
  }

  /** Moves every price by a small random step; `shock` adds a drift in bps to the named symbols. */
  step(shock: Record<string, number> = {}) {
    for (const [s, p] of this.prices) {
      const noise = (this.rand() - 0.5) * 0.0008;
      this.prices.set(s, p * (1 + noise + (shock[s] ?? 0) / 10_000));
    }
  }

  async list() {
    return this.entries.map(({ price: _p, liquidity: _l, ...e }) => e);
  }

  async poolLiquidityUsdg(e: RegistryEntry) {
    return (this.liquidity.get(e.symbol) ?? 0).toFixed(2);
  }

  async buy(token: TokenRef, usdgIn: string) {
    this.checkPaused(token.symbol);
    const px = this.px(token.symbol) * (1 + this.impact(token.symbol, Number(usdgIn)));
    return { tokensOut: (Number(usdgIn) / px).toFixed(token.decimals > 12 ? 12 : token.decimals) };
  }

  async sell(token: TokenRef, tokensIn: string) {
    this.checkPaused(token.symbol);
    const gross = Number(tokensIn) * this.px(token.symbol);
    return { usdgOut: (gross * (1 - this.impact(token.symbol, gross))).toFixed(6) };
  }

  start(onTick: (t: Tick) => void) {
    const id = setInterval(() => {
      this.step();
      for (const s of this.symbols) onTick({ symbol: s, px: this.px(s).toFixed(4), src: s === "BTC" ? "spot" : "futures", ts: new Date() });
    }, 2000);
    return () => clearInterval(id);
  }

  px(symbol: string): number {
    const p = this.prices.get(symbol);
    if (p === undefined) throw new Error(`sim: unknown symbol ${symbol}`);
    return p;
  }

  private checkPaused(symbol: string) {
    if (this.paused.has(symbol)) throw new QuoteError("paused", `${symbol} pool paused`);
  }

  private impact(symbol: string, usdg: number) {
    return (0.6 * usdg) / (this.liquidity.get(symbol) ?? 1);
  }

  private rand() {
    this.seed = (this.seed * 1664525 + 1013904223) % 2 ** 32;
    return this.seed / 2 ** 32;
  }
}
