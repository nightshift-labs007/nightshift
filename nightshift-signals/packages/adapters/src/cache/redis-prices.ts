import { RING_MINUTES, type CachedPrice, type PriceCache } from "@nightshift-signals/core";
import { Redis } from "ioredis";

/** `fp:px` hash holds the last price per symbol; `fp:px:ring:<symbol>` keeps one sample per minute. */
export class RedisPriceCache implements PriceCache {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
  }

  async set(symbol: string, price: CachedPrice) {
    const ring = `fp:px:ring:${symbol}`;
    const prev = await this.redis.hget("fp:px", symbol);
    const sameMinute = prev && (JSON.parse(prev) as CachedPrice).ts.slice(0, 16) === price.ts.slice(0, 16);
    const tx = this.redis.multi().hset("fp:px", symbol, JSON.stringify(price));
    if (sameMinute) tx.lset(ring, 0, JSON.stringify(price));
    else tx.lpush(ring, JSON.stringify(price)).ltrim(ring, 0, RING_MINUTES - 1);
    await tx.exec();
  }

  async get(symbol: string) {
    const v = await this.redis.hget("fp:px", symbol);
    return v ? (JSON.parse(v) as CachedPrice) : null;
  }

  async getMany(symbols: string[]) {
    if (symbols.length === 0) return new Map<string, CachedPrice>();
    const vals = await this.redis.hmget("fp:px", ...symbols);
    return new Map(symbols.flatMap((s, i) => (vals[i] ? [[s, JSON.parse(vals[i]!) as CachedPrice] as const] : [])));
  }

  async history(symbol: string) {
    const vals = await this.redis.lrange(`fp:px:ring:${symbol}`, 0, -1);
    return vals.map((v) => JSON.parse(v) as CachedPrice).reverse();
  }

  async close() {
    await this.redis.quit();
  }
}
