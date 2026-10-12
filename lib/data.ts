import { GLOBAL_MARKETS, PAIRS, type Pair } from "./config";
import { etParts, etToUtcMs, isWeekday } from "./time";

export type Bar = { t: number; o: number; c: number }; // t = bar start, epoch seconds
export type Chart = { symbol: string; bars: Bar[]; price: number };
export type Source = "live" | "simulated";

export type Session = { date: string; openT: number; closeT: number; open: number; close: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function fetchChart(
  symbol: string,
  interval: "5m" | "1h" | "1d",
  range: "1d" | "5d" | "1mo" | "3mo",
  prePost = false,
): Promise<Chart | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}${prePost ? "&includePrePost=true" : ""}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      next: { revalidate: interval === "1d" ? 600 : 120 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return fallbackChart(symbol, interval, range); // blocked or rate-limited: try the second provider
    const json = await res.json();
    const r = json?.chart?.result?.[0];
    const ts: number[] = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0] ?? {};
    const bars: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const c = q.close?.[i];
      if (typeof o === "number" && typeof c === "number") bars.push({ t: ts[i], o, c });
    }
    if (bars.length < (prePost ? 1 : 5)) return fallbackChart(symbol, interval, range);
    const price = typeof r.meta?.regularMarketPrice === "number" ? r.meta.regularMarketPrice : bars[bars.length - 1].c;
    return { symbol, bars, price };
  } catch {
    return fallbackChart(symbol, interval, range);
  }
}

// ---------- second provider: Twelve Data (only with TWELVEDATA_API_KEY) ----------
// Yahoo's endpoint is unofficial and sometimes blocks cloud IPs; this is tried before anything becomes "simulated".
// The free tier has no index futures, so ES=F / NQ=F / ^N225 etc. stay Yahoo-only; gold futures use spot gold.
const TD_SYMBOL: Record<string, string> = {
  SPY: "SPY", QQQ: "QQQ", GLD: "GLD", IBIT: "IBIT",
  "BTC-USD": "BTC/USD", "GC=F": "XAU/USD",
  AAPL: "AAPL", NVDA: "NVDA", MSFT: "MSFT", TSLA: "TSLA", GOOGL: "GOOGL", AMZN: "AMZN", META: "META", AVGO: "AVGO",
  TSM: "TSM", "BRK-B": "BRK.B", JPM: "JPM", LLY: "LLY", V: "V", MA: "MA", ORCL: "ORCL", NFLX: "NFLX", AMD: "AMD", WMT: "WMT", COST: "COST", XOM: "XOM",
};
const TD_INTERVAL = { "5m": "5min", "1h": "1h", "1d": "1day" } as const;
const TD_SIZE: Record<string, number> = { "1d": 300, "5d": 130, "1mo": 35, "3mo": 70 };

async function fallbackChart(symbol: string, interval: "5m" | "1h" | "1d", range: "1d" | "5d" | "1mo" | "3mo"): Promise<Chart | null> {
  const key = process.env.TWELVEDATA_API_KEY?.trim();
  const td = TD_SYMBOL[symbol];
  if (!key || !td) return null;
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(td)}&interval=${TD_INTERVAL[interval]}&outputsize=${TD_SIZE[range]}&timezone=UTC&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: interval === "1d" ? 600 : 120 }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { status?: string; values?: { datetime: string; open: string; close: string }[] };
    if (j.status !== "ok" || !j.values?.length) return null;
    const bars: Bar[] = j.values
      .map((v) => ({ t: Math.floor(Date.parse(v.datetime.replace(" ", "T") + "Z") / 1000), o: Number(v.open), c: Number(v.close) }))
      .filter((b) => Number.isFinite(b.t) && b.o > 0 && b.c > 0)
      .reverse();
    if (bars.length < 5) return null;
    return { symbol, bars, price: bars[bars.length - 1].c };
  } catch {
    return null;
  }
}

/** Price at time T (epoch s) using only information available at or before T. */
export function priceAt(bars: Bar[], T: number, barSeconds = 3600): number | null {
  let hit: Bar | null = null;
  for (const b of bars) {
    if (b.t <= T) hit = b;
    else break;
  }
  if (!hit) return null;
  return T < hit.t + barSeconds ? hit.o : hit.c;
}

/** Daily ETF bars -> regular sessions with exact 09:30 / 16:00 ET timestamps. */
export function toSessions(daily: Bar[]): Session[] {
  const out: Session[] = [];
  for (const b of daily) {
    const date = etParts(b.t * 1000 + 3 * 3600 * 1000).date; // nudge past midnight-stamped bars
    if (out.length && out[out.length - 1].date === date) continue;
    out.push({
      date,
      openT: etToUtcMs(date, 9, 30) / 1000,
      closeT: etToUtcMs(date, 16, 0) / 1000,
      open: b.o,
      close: b.c,
    });
  }
  return out;
}

// ---------- deterministic simulation (used only when live feeds are blocked) ----------

function rng(seedStr: string) {
  let s = 0;
  for (const ch of seedStr) s = (Math.imul(s ^ ch.charCodeAt(0), 2654435761) >>> 0) + 1;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

const SIM_EPOCH = Date.UTC(2026, 0, 1) / 1000;

function simulateHourly(symbol: string, base: number, vol: number): Chart {
  const r = rng(symbol);
  const nowH = Math.floor(Date.now() / 3600000) * 3600;
  const bars: Bar[] = [];
  let p = base;
  for (let t = SIM_EPOCH; t <= nowH; t += 3600) {
    const o = p;
    p = p * (1 + vol * gauss(r) + vol * 0.02);
    if (t >= nowH - 31 * 86400) bars.push({ t, o, c: p });
  }
  return { symbol, bars, price: bars[bars.length - 1].c };
}

export function simulatePair(pair: Pair) {
  const anchor = simulateHourly(pair.anchor, pair.sim.anchor, pair.sim.hourlyVol);
  const r = rng(pair.token);
  const ratio = pair.sim.etf / pair.sim.anchor;
  const noise = () => 1 + 0.0006 * gauss(r);
  const daily: Bar[] = [];
  const nowS = Date.now() / 1000;
  for (let d = 31; d >= 0; d--) {
    const p = etParts(Date.now() - d * 86400000);
    if (!isWeekday(p.weekday)) continue;
    const openT = etToUtcMs(p.date, 9, 30) / 1000;
    const closeT = etToUtcMs(p.date, 16, 0) / 1000;
    if (openT > nowS) continue;
    const o = (priceAt(anchor.bars, openT) ?? pair.sim.anchor) * ratio * noise();
    const c = (priceAt(anchor.bars, Math.min(closeT, nowS)) ?? pair.sim.anchor) * ratio * noise();
    daily.push({ t: openT, o, c });
  }
  const last = daily[daily.length - 1];
  return { etf: { symbol: pair.token, bars: daily, price: last.c } as Chart, anchor };
}

// ---------- public loaders ----------

export type PairData = { pair: Pair; etf: Chart; anchor: Chart; source: Source };

export async function loadPair(pair: Pair): Promise<PairData> {
  const [etf, anchor] = await Promise.all([fetchChart(pair.token, "1d", "1mo"), fetchChart(pair.anchor, "1h", "1mo")]);
  if (etf && anchor) return { pair, etf, anchor, source: "live" };
  return { pair, ...simulatePair(pair), source: "simulated" };
}

export async function loadAllPairs() {
  return Promise.all(PAIRS.map(loadPair));
}

export async function loadGlobals(): Promise<{ name: string; chart: Chart; source: Source }[]> {
  return Promise.all(
    GLOBAL_MARKETS.map(async (g) => {
      const live = await fetchChart(g.symbol, "1h", "1mo");
      return live
        ? { name: g.name, chart: live, source: "live" as const }
        : { name: g.name, chart: simulateHourly(g.symbol, 40000, 0.0009), source: "simulated" as const };
    }),
  );
}

/** Crypto Fear & Greed index (alternative.me, free, no key). */
export async function loadFearGreed(): Promise<{ value: number; previous: number; label: string } | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=2", {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(5000),
    });
    const j = await res.json();
    const [now, prev] = j.data;
    return { value: Number(now.value), previous: Number(prev.value), label: now.value_classification };
  } catch {
    return null;
  }
}
