import "server-only";
import { cacheGet, cacheSet } from "@/lib/play/store";
import { closeUtcMs, etParts, etToUtcMs } from "@/lib/time";
import { afterFailure, coolingDown, fresh, isThrottle, type Backoff } from "./backoff";
import { confirmClose, confirmOpen, type YahooChart } from "./yahoo-parse";

/**
 * Where official closes and opens come from. Everything that settles a round (the points game, "Beat the AI", the
 * keeper's "Call the Open") goes through `officialClose` / `officialOpen` here, never straight to a vendor.
 *
 * To plug in a licensed feed: implement PriceProvider (return null whenever a price isn't confirmed yet; never
 * guess), add it to PROVIDERS, and set PRICE_PROVIDER=<name>. Confirmed prices are cached per provider forever
 * (an official close or open never changes), and a provider that throttles is backed off exponentially.
 */
export interface PriceProvider {
  name: string;
  /** Official regular-session close of `symbol` on trading date `date` (YYYY-MM-DD, New York), or null if not confirmed. */
  close(symbol: string, date: string): Promise<number | null>;
  /** Official 09:30 ET open of `symbol` on `date`, with the second reading that confirmed it, or null. */
  open(symbol: string, date: string): Promise<{ open: number; check: number } | null>;
}

// ---------------------------------------------------------------- Yahoo (default; unofficial, no key)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HOSTS = ["query1", "query2"] as const;
const g = globalThis as unknown as { __priceBackoff?: Map<string, Backoff> };
const backoff = (g.__priceBackoff ??= new Map());
const etDate = (ms: number) => etParts(ms).date;

/** One chart request, skipping hosts that are cooling down and backing a host off when it throttles. */
async function yahooChart(symbol: string, query: string): Promise<YahooChart | null> {
  for (const host of HOSTS) {
    const now = Date.now();
    if (coolingDown(backoff.get(host), now)) continue;
    const res = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res?.ok) {
      if (isThrottle(res?.status ?? null)) backoff.set(host, afterFailure(backoff.get(host), now));
      continue;
    }
    backoff.set(host, fresh());
    const r = (await res.json().catch(() => null))?.chart?.result?.[0];
    if (r) return r as YahooChart;
  }
  return null;
}

const yahoo: PriceProvider = {
  name: "yahoo",
  async close(symbol, date) {
    const [daily, five] = await Promise.all([yahooChart(symbol, "interval=1d&range=1mo"), yahooChart(symbol, "interval=5m&range=5d")]);
    return confirmClose(daily, five, date, closeUtcMs(date) / 1000 - 300, etDate);
  },
  async open(symbol, date) {
    const [one, five] = await Promise.all([yahooChart(symbol, "interval=1m&range=5d"), yahooChart(symbol, "interval=5m&range=5d")]);
    return confirmOpen(one, five, etToUtcMs(date, 9, 30) / 1000);
  },
};

// ---------------------------------------------------------------- selection, cache

const PROVIDERS: Record<string, PriceProvider> = { yahoo };

export function priceProvider(): PriceProvider {
  const name = (process.env.PRICE_PROVIDER ?? "yahoo").trim().toLowerCase();
  return PROVIDERS[name] ?? yahoo;
}

/** Which sources are cooling down right now (for /api/health and debugging). */
export const priceBackoff = () => Object.fromEntries([...backoff].filter(([, b]) => b.until > Date.now()).map(([h, b]) => [h, { failures: b.failures, until: new Date(b.until).toISOString() }]));

export async function officialClose(symbol: string, date: string): Promise<number | null> {
  const p = priceProvider();
  const key = `px:${p.name}:close:${symbol}:${date}`;
  const hit = await cacheGet(key);
  if (hit) return Number(hit);
  const v = await p.close(symbol, date);
  if (v) await cacheSet(key, String(v));
  return v;
}

export async function officialOpen(symbol: string, date: string): Promise<{ open: number; check: number } | null> {
  const p = priceProvider();
  const key = `px:${p.name}:open:${symbol}:${date}`;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as { open: number; check: number };
  const v = await p.open(symbol, date);
  if (v) await cacheSet(key, JSON.stringify(v));
  return v;
}
