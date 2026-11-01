import type { PriceSource } from "./enums";

export interface CachedPrice {
  px: string;
  src: PriceSource;
  ts: string;
}

/** Last price per symbol plus a 24-hour ring buffer of minute samples. Redis in production. */
export interface PriceCache {
  set(symbol: string, price: CachedPrice): Promise<void>;
  get(symbol: string): Promise<CachedPrice | null>;
  getMany(symbols: string[]): Promise<Map<string, CachedPrice>>;
  history(symbol: string): Promise<CachedPrice[]>;
}

export const RING_MINUTES = 24 * 60;

export class MemoryPriceCache implements PriceCache {
  private last = new Map<string, CachedPrice>();
  private ring = new Map<string, CachedPrice[]>();

  async set(symbol: string, price: CachedPrice) {
    const prev = this.last.get(symbol);
    this.last.set(symbol, price);
    const ring = this.ring.get(symbol) ?? [];
    if (!prev || prev.ts.slice(0, 16) !== price.ts.slice(0, 16)) ring.push(price);
    else ring[ring.length - 1] = price;
    if (ring.length > RING_MINUTES) ring.shift();
    this.ring.set(symbol, ring);
  }

  async get(symbol: string) {
    return this.last.get(symbol) ?? null;
  }

  async getMany(symbols: string[]) {
    return new Map(symbols.flatMap((s) => (this.last.has(s) ? [[s, this.last.get(s)!] as const] : [])));
  }

  async history(symbol: string) {
    return [...(this.ring.get(symbol) ?? [])];
  }
}
