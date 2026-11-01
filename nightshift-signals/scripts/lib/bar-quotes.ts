import { QuoteError, type QuoteSource, type TokenRef } from "@nightshift-signals/adapters";
import { and, desc, eq, lte, priceBars1m, tokens, type Db } from "@nightshift-signals/db";

/**
 * Historical quotes for replay: the token's 1-minute bar at the replay clock, with price impact
 * modeled from pool depth (0.6 × size / liquidity). An approximation; live grading uses real quotes.
 */
export class BarQuotes implements QuoteSource {
  constructor(
    private db: Db,
    private now: () => Date,
  ) {}

  async buy(token: TokenRef, usdgIn: string) {
    const { px, liq } = await this.state(token.symbol);
    return { tokensOut: (Number(usdgIn) / (px * (1 + (0.6 * Number(usdgIn)) / liq))).toFixed(12) };
  }

  async sell(token: TokenRef, tokensIn: string) {
    const { px, liq } = await this.state(token.symbol);
    const gross = Number(tokensIn) * px;
    return { usdgOut: (gross * (1 - (0.6 * gross) / liq)).toFixed(6) };
  }

  private async state(symbol: string) {
    const [bar] = await this.db
      .select({ c: priceBars1m.c })
      .from(priceBars1m)
      .where(and(eq(priceBars1m.symbol, symbol), lte(priceBars1m.ts, this.now())))
      .orderBy(desc(priceBars1m.ts))
      .limit(1);
    const [t] = await this.db.select({ liq: tokens.poolLiquidityUsdg }).from(tokens).where(eq(tokens.symbol, symbol));
    if (!bar) throw new QuoteError("unavailable", `no bar for ${symbol}`);
    return { px: Number(bar.c), liq: Number(t?.liq ?? 0) || 1 };
  }
}
