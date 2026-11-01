import { fairValue, gapBps, isProxyLive, lastClose, proxyReturn, type PriceCache } from "@nightshift-signals/core";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "./client";
import { priceBars1m, tokens } from "./schema";

export interface FairValueGap {
  symbol: string;
  underlying: string;
  mid: string;
  fv: string;
  gap_bps: number;
  /** Proxy market closed (weekend or futures break): fair value is held at its last value. */
  frozen: boolean;
  as_of: string;
}

/** Live fair-value gaps per underlying ticker; empty when unknown. */
export interface FairValueReader {
  gaps(tickers: string[]): Promise<Map<string, FairValueGap>>;
}

/**
 * FV = last_close × (1 + β × Δproxy), with Δproxy measured from the proxy's last bar before the
 * 16:00 ET close. Unknown (no entry in the map) when any input is missing; never guessed.
 */
export class FairValueService implements FairValueReader {
  private closeCache = new Map<string, string | null>();

  constructor(
    private db: Db,
    private prices: PriceCache,
    private now: () => Date = () => new Date(),
  ) {}

  async gaps(tickers: string[]): Promise<Map<string, FairValueGap>> {
    const rows = await this.db.select().from(tokens).where(eq(tokens.eligible, true));
    return this.compute(rows.filter((r) => tickers.includes(r.underlyingTicker)));
  }

  async all(): Promise<Map<string, FairValueGap>> {
    return this.compute(await this.db.select().from(tokens).where(eq(tokens.active, true)));
  }

  private async compute(rows: (typeof tokens.$inferSelect)[]): Promise<Map<string, FairValueGap>> {
    const now = this.now();
    const close = lastClose(now);
    const out = new Map<string, FairValueGap>();
    for (const t of rows) {
      if (!t.proxy || !t.lastClose || !t.beta) continue;
      const mid = await this.prices.get(t.symbol);
      if (!mid) continue;
      const parts = [];
      for (const p of t.proxy.split("+")) {
        const [nowPx, closePx] = [await this.prices.get(p), await this.proxyClose(p, close)];
        if (!nowPx || !closePx) break;
        parts.push({ now: nowPx.px, close: closePx });
      }
      if (parts.length !== t.proxy.split("+").length) continue;
      const fv = fairValue(t.lastClose, t.beta, proxyReturn(parts));
      out.set(t.underlyingTicker, {
        symbol: t.symbol,
        underlying: t.underlyingTicker,
        mid: mid.px,
        fv,
        gap_bps: gapBps(mid.px, fv),
        frozen: !isProxyLive(t.proxy, now),
        as_of: mid.ts,
      });
    }
    return out;
  }

  private async proxyClose(symbol: string, close: Date): Promise<string | null> {
    const key = `${symbol}@${close.toISOString()}`;
    if (this.closeCache.has(key)) return this.closeCache.get(key)!;
    const [bar] = await this.db
      .select({ c: priceBars1m.c })
      .from(priceBars1m)
      .where(and(eq(priceBars1m.symbol, symbol), lt(priceBars1m.ts, close)))
      .orderBy(desc(priceBars1m.ts))
      .limit(1);
    const px = bar?.c ?? null;
    if (px) this.closeCache.set(key, px);
    return px;
  }
}
