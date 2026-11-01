import "server-only";

/**
 * Daily history for the India research engine: Indian indices plus the overnight drivers that are known before the
 * NSE opens at 09:15 IST (the US session, crude, gold, the rupee). Public Yahoo Finance endpoints, cached for hours.
 */

export type DailyBar = { date: string; o: number; h: number; l: number; c: number };
export type Series = { symbol: string; bars: DailyBar[] };

export const INDIA_SYMBOLS = {
  nifty: "^NSEI",
  sensex: "^BSESN",
  bankNifty: "^NSEBANK",
  niftyIt: "^CNXIT",
  vix: "^INDIAVIX",
  usdinr: "INR=X",
  spx: "^GSPC",
  crude: "CL=F",
  gold: "GC=F",
} as const;
export type SeriesKey = keyof typeof INDIA_SYMBOLS;

async function fetchDaily(symbol: string): Promise<Series | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5y`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 6 * 3600 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null;
    const off = Number(r.meta?.gmtoffset ?? 0); // the exchange's own calendar date, not UTC's
    const bars: DailyBar[] = [];
    (r.timestamp as number[]).forEach((t, i) => {
      const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
      if (![o, h, l, c].every((x) => typeof x === "number" && x > 0)) return;
      // Futures sessions start at 18:00 New York the evening before, and Yahoo stamps the bar with that start, so a bar
      // stamped in the evening belongs to the next day's session. Without this, oil and gold would leak a day ahead.
      const local = new Date((t + off) * 1000);
      if (local.getUTCHours() >= 18) local.setUTCDate(local.getUTCDate() + 1);
      bars.push({ date: local.toISOString().slice(0, 10), o, h, l, c });
    });
    // a day can appear twice when Yahoo appends today's live bar; keep the last
    const byDate = new Map(bars.map((b) => [b.date, b]));
    return { symbol, bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  } catch {
    return null;
  }
}

export async function loadIndiaData(): Promise<Partial<Record<SeriesKey, Series>>> {
  const keys = Object.keys(INDIA_SYMBOLS) as SeriesKey[];
  const all = await Promise.all(keys.map((k) => fetchDaily(INDIA_SYMBOLS[k])));
  return Object.fromEntries(keys.flatMap((k, i) => (all[i] && all[i]!.bars.length > 50 ? [[k, all[i]]] : [])));
}
