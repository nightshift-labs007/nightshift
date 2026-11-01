import { Redis } from "ioredis";

export interface RateLimiter {
  /** True if this hit is within the limit for the current one-minute window. */
  hit(key: string, perMinute: number): Promise<boolean>;
}

export class MemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { minute: number; n: number }>();
  async hit(key: string, perMinute: number) {
    const minute = Math.floor(Date.now() / 60_000);
    const w = this.windows.get(key);
    if (!w || w.minute !== minute) {
      this.windows.set(key, { minute, n: 1 });
      if (this.windows.size > 50_000) this.windows.clear();
      return true;
    }
    return ++w.n <= perMinute;
  }
}

export class RedisRateLimiter implements RateLimiter {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 1 });
  }
  async hit(key: string, perMinute: number) {
    const k = `fp:rl:${key}:${Math.floor(Date.now() / 60_000)}`;
    const [[, n]] = (await this.redis.multi().incr(k).expire(k, 61).exec()) as [[null, number], unknown];
    return n <= perMinute;
  }
}
