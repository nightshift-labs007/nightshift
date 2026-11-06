import { fetchChart, priceAt, toSessions, type Bar } from "./data";
import { marketStatus } from "./time";

// Large-cap US leaders tracked by the stock board. Tech names are anchored to Nasdaq-100 futures,
// the rest to S&P 500 futures; each stock's sensitivity (beta) is measured from its own history.
export type StockDef = { ticker: string; name: string; logo?: string; anchor: "NQ=F" | "ES=F"; sector: string };

export const STOCKS: StockDef[] = [
  { ticker: "AAPL", name: "Apple", logo: "AAPL", anchor: "NQ=F", sector: "Technology" },
  { ticker: "NVDA", name: "Nvidia", logo: "NVDA", anchor: "NQ=F", sector: "Semiconductors" },
  { ticker: "MSFT", name: "Microsoft", logo: "MSFT", anchor: "NQ=F", sector: "Technology" },
  { ticker: "TSLA", name: "Tesla", logo: "TSLA", anchor: "NQ=F", sector: "Automotive" },
  { ticker: "GOOGL", name: "Alphabet", logo: "GOOGL", anchor: "NQ=F", sector: "Communication" },
  { ticker: "AMZN", name: "Amazon", anchor: "NQ=F", sector: "Consumer" },
  { ticker: "META", name: "Meta", logo: "META", anchor: "NQ=F", sector: "Communication" },
  { ticker: "AVGO", name: "Broadcom", logo: "AVGO", anchor: "NQ=F", sector: "Semiconductors" },
  { ticker: "TSM", name: "TSMC", anchor: "NQ=F", sector: "Semiconductors" },
  { ticker: "BRK-B", name: "Berkshire Hathaway", anchor: "ES=F", sector: "Financials" },
  { ticker: "JPM", name: "JPMorgan Chase", anchor: "ES=F", sector: "Financials" },
  { ticker: "LLY", name: "Eli Lilly", anchor: "ES=F", sector: "Healthcare" },
  { ticker: "V", name: "Visa", logo: "V", anchor: "ES=F", sector: "Financials" },
  { ticker: "MA", name: "Mastercard", logo: "MA", anchor: "ES=F", sector: "Financials" },
  { ticker: "ORCL", name: "Oracle", anchor: "NQ=F", sector: "Technology" },
  { ticker: "NFLX", name: "Netflix", logo: "NFLX", anchor: "NQ=F", sector: "Communication" },
  { ticker: "AMD", name: "AMD", logo: "AMD", anchor: "NQ=F", sector: "Semiconductors" },
  { ticker: "WMT", name: "Walmart", anchor: "ES=F", sector: "Consumer" },
  { ticker: "COST", name: "Costco", anchor: "NQ=F", sector: "Consumer" },
  { ticker: "XOM", name: "Exxon Mobil", anchor: "ES=F", sector: "Energy" },
];

export const HEADLINE = ["AAPL", "NVDA", "MSFT", "TSLA"];

export type StockQuote = {
  ticker: string;
  name: string;
  logo: string | null;
  sector: string;
  anchorName: string;
  marketOpen: boolean;
  price: number; // last regular-session trade
  lastClose: number;
  dayChangePct: number;
  fairValue: number; // Nightshift estimate now
  driftPct: number; // fair value vs last close
  confidence: number;
  beta: number;
  r2: number;
  anchorMovePct: number;
  extended: { price: number; at: string; vsFairBps: number } | null; // latest pre/after-hours trade
  ret1mPct: number;
  ret3mPct: number;
  vol30Pct: number; // annualised
  offHighPct: number; // distance from the 3-month high
  spark: number[];
};

export type StockBoard = {
  updatedAt: string;
  market: ReturnType<typeof marketStatus>;
  futures: { symbol: string; name: string; movePct: number }[];
  stocks: StockQuote[];
  missing: string[];
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const ANCHOR_NAMES = { "NQ=F": "Nasdaq-100 futures", "ES=F": "S&P 500 futures" } as const;
export const BENCH = { "NQ=F": "QQQ", "ES=F": "SPY" } as const;

function dailyReturns(bars: Bar[]) {
  const m = new Map<string, number>();
  const sessions = toSessions(bars);
  for (let i = 1; i < sessions.length; i++) m.set(sessions[i].date, sessions[i].close / sessions[i - 1].close - 1);
  return m;
}

export function betaOf(stock: Bar[], bench: Bar[]) {
  const a = dailyReturns(stock);
  const b = dailyReturns(bench);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, y] of a) {
    const x = b.get(d);
    if (x !== undefined) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < 15) return { beta: 1, r2: 0.3 };
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  const beta = vx ? cov / vx : 1;
  const r2 = vx && vy ? (cov * cov) / (vx * vy) : 0;
  // Blume adjustment: short-window single-stock betas are noisy, so pull them toward 1
  return { beta: clamp(0.67 * beta + 0.33, 0.3, 3), r2: clamp(r2, 0, 1) };
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function getStockBoard(): Promise<StockBoard> {
  const nowS = Date.now() / 1000;
  const market = marketStatus();
  const [nq, es, qqq, spy] = await Promise.all([
    fetchChart("NQ=F", "1h", "5d"),
    fetchChart("ES=F", "1h", "5d"),
    fetchChart("QQQ", "1d", "3mo"),
    fetchChart("SPY", "1d", "3mo"),
  ]);
  const anchors = { "NQ=F": nq, "ES=F": es };
  const benches = { QQQ: qqq, SPY: spy };

  const rows = await inBatches(STOCKS, 5, async (def) => {
    const [daily, ext] = await Promise.all([fetchChart(def.ticker, "1d", "3mo"), fetchChart(def.ticker, "5m", "1d", true)]);
    if (!daily) return null;
    const sessions = toSessions(daily.bars);
    const completed = sessions.filter((s) => s.closeT <= nowS);
    if (completed.length < 2) return null;
    const last = completed[completed.length - 1];
    const prev = completed[completed.length - 2];
    const live = sessions[sessions.length - 1];
    const inSession = market.open && live.openT <= nowS && nowS < live.closeT;

    const anchor = anchors[def.anchor];
    const anchorNow = anchor?.price ?? 0;
    const anchorThen = anchor ? priceAt(anchor.bars, last.closeT) ?? anchorNow : 0;
    const anchorMove = anchor && anchorThen ? anchorNow / anchorThen - 1 : 0;
    const bench = benches[BENCH[def.anchor]];
    const { beta, r2 } = bench ? betaOf(daily.bars, bench.bars) : { beta: 1, r2: 0.3 };

    const price = daily.price;
    let fair: number;
    let confidence: number;
    if (inSession) {
      fair = price;
      confidence = 99;
    } else {
      fair = last.close * (1 + beta * anchorMove);
      const hours = (nowS - last.closeT) / 3600;
      confidence = Math.round(clamp(97 - hours * 0.3 - (1 - r2) * 25 - (anchor ? 0 : 20), 35, 95));
    }

    let extended: StockQuote["extended"] = null;
    if (ext && !inSession) {
      const b = ext.bars[ext.bars.length - 1];
      if (b && b.t > last.closeT - 300) {
        extended = { price: b.c, at: new Date(b.t * 1000).toISOString(), vsFairBps: (b.c / fair - 1) * 1e4 };
      }
    }

    const closes = completed.map((s) => s.close);
    const rets = closes.slice(1).map((c, i) => c / closes[i] - 1);
    const r21 = rets.slice(-21);
    const mean = r21.reduce((s, v) => s + v, 0) / (r21.length || 1);
    const vol = Math.sqrt(r21.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, r21.length - 1)) * Math.sqrt(252);
    const ref = inSession ? price : last.close;
    const hi = Math.max(...closes, ref);
    const at21 = closes[Math.max(0, closes.length - 22)];

    const q: StockQuote = {
      ticker: def.ticker,
      name: def.name,
      logo: def.logo ?? null,
      sector: def.sector,
      anchorName: ANCHOR_NAMES[def.anchor],
      marketOpen: inSession,
      price,
      lastClose: last.close,
      dayChangePct: inSession ? (price / last.close - 1) * 100 : (last.close / prev.close - 1) * 100,
      fairValue: fair,
      driftPct: (fair / last.close - 1) * 100,
      confidence,
      beta,
      r2,
      anchorMovePct: anchorMove * 100,
      extended,
      ret1mPct: (ref / at21 - 1) * 100,
      ret3mPct: (ref / closes[0] - 1) * 100,
      vol30Pct: vol * 100,
      offHighPct: (ref / hi - 1) * 100,
      spark: closes.slice(-60),
    };
    return q;
  });

  const stocks = rows.filter((r): r is StockQuote => r !== null);
  const futures = (["NQ=F", "ES=F"] as const).flatMap((s) => {
    const sample = stocks.find((x) => x.anchorName === ANCHOR_NAMES[s]);
    return sample ? [{ symbol: s, name: ANCHOR_NAMES[s], movePct: sample.anchorMovePct }] : [];
  });
  return {
    updatedAt: new Date().toISOString(),
    market,
    futures,
    stocks,
    missing: STOCKS.filter((d) => !stocks.some((s) => s.ticker === d.ticker)).map((d) => d.ticker),
  };
}

// ---------------------------------------------------------------- one stock in detail

export type StockRange = "1D" | "5D" | "1M" | "3M";
export const STOCK_RANGES: StockRange[] = ["1D", "5D", "1M", "3M"];

export type StockCall = { date: string; prevClose: number; predictedOpen: number; actualOpen: number; nightshiftErrBps: number; staleErrBps: number };

export type StockDetail = {
  ticker: string;
  range: StockRange;
  lastClose: number;
  closeT: number; // epoch s of the last completed close: points after it are Nightshift fair value
  points: { t: number; v: number; fair?: true }[];
  calls: StockCall[]; // newest first
  avgNightshiftBps: number;
  avgStaleBps: number;
  wins: number;
};

const SPAN: Record<StockRange, { interval: "5m" | "1h" | "1d"; range: "1d" | "5d" | "1mo" | "3mo"; bar: number }> = {
  "1D": { interval: "5m", range: "1d", bar: 300 },
  "5D": { interval: "1h", range: "5d", bar: 3600 },
  "1M": { interval: "1h", range: "1mo", bar: 3600 },
  "3M": { interval: "1d", range: "3mo", bar: 86400 },
};

/**
 * The stock's price over the chosen window, continued past the last close by Nightshift's fair value (the close moved
 * by beta x the anchor future's change since then), and every recent open replayed: the call the engine would have made
 * from data before 09:30 ET, graded against the real open and against a frozen price that just repeats the close.
 */
export async function getStockDetail(ticker: string, range: StockRange): Promise<StockDetail | null> {
  const def = STOCKS.find((s) => s.ticker === ticker);
  if (!def) return null;
  const nowS = Date.now() / 1000;
  const span = SPAN[range];
  const [daily, bench, anchorHour, anchorFine, chart] = await Promise.all([
    fetchChart(def.ticker, "1d", "3mo"),
    fetchChart(BENCH[def.anchor], "1d", "3mo"),
    fetchChart(def.anchor, "1h", "1mo"),
    fetchChart(def.anchor, "5m", "5d"),
    span.interval === "1d" ? Promise.resolve(null) : fetchChart(def.ticker, span.interval, span.range),
  ]);
  if (!daily) return null;
  const sessions = toSessions(daily.bars);
  const completed = sessions.filter((s) => s.closeT <= nowS);
  const last = completed[completed.length - 1];
  if (!last) return null;
  const { beta } = bench ? betaOf(daily.bars, bench.bars) : { beta: 1 };

  // market prices up to now (during the session) or up to the close; daily view uses session closes
  let points: StockDetail["points"] = span.interval === "1d" ? sessions.map((s) => ({ t: Math.min(s.closeT, nowS), v: s.close })) : (chart?.bars ?? []).map((b) => ({ t: b.t, v: b.c }));
  points = points.filter((p) => p.t <= nowS);
  const live = sessions[sessions.length - 1];
  const inSession = live.openT <= nowS && nowS < live.closeT;
  if (!inSession) {
    points = points.filter((p) => p.t < last.closeT);
    points.push({ t: last.closeT, v: last.close });
    const fine = anchorFine?.bars ?? [];
    const base = priceAt(fine, last.closeT, 300) ?? priceAt(anchorHour?.bars ?? [], last.closeT);
    if (base) {
      let tail = fine.filter((b) => b.t > last.closeT).map((b) => ({ t: b.t, v: last.close * (1 + beta * (b.c / base - 1)), fair: true as const }));
      // keep the tail readable next to a long daily history: one point per bar of the main window
      if (span.bar > 300) tail = tail.filter((p, i) => i === tail.length - 1 || Math.floor(p.t / span.bar) !== Math.floor(tail[i + 1].t / span.bar));
      points.push(...tail);
    }
  }

  const calls: StockCall[] = [];
  const aBars = anchorHour?.bars ?? [];
  for (let i = sessions.length - 1; i >= 1 && calls.length < 20; i--) {
    const s = sessions[i];
    const prev = sessions[i - 1];
    if (s.openT > nowS) continue;
    const aClose = priceAt(aBars, prev.closeT);
    const aOpen = priceAt(aBars, s.openT);
    if (!aClose || !aOpen) break; // the anchor's hourly history ends here
    const predictedOpen = prev.close * (1 + beta * (aOpen / aClose - 1));
    calls.push({
      date: s.date,
      prevClose: prev.close,
      predictedOpen,
      actualOpen: s.open,
      nightshiftErrBps: Math.abs(predictedOpen / s.open - 1) * 1e4,
      staleErrBps: Math.abs(prev.close / s.open - 1) * 1e4,
    });
  }
  const avg = (k: "nightshiftErrBps" | "staleErrBps") => (calls.length ? calls.reduce((a, c) => a + c[k], 0) / calls.length : 0);
  return {
    ticker: def.ticker,
    range,
    lastClose: last.close,
    closeT: last.closeT,
    points,
    calls,
    avgNightshiftBps: avg("nightshiftErrBps"),
    avgStaleBps: avg("staleErrBps"),
    wins: calls.filter((c) => c.nightshiftErrBps < c.staleErrBps).length,
  };
}
