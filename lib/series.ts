import { PAIRS } from "./config";
import { fetchChart, loadPair, priceAt, toSessions, type Source } from "./data";

export const RANGES = { "1H": 1, "4H": 4, "12H": 12, "24H": 24 } as const;
export type Range = keyof typeof RANGES;

export type FairSeries = {
  token: string;
  range: Range;
  source: Source;
  basis: "anchor" | "market"; // anchor-implied fair value, or the ETF itself while Wall Street is open
  lastClose: number;
  points: { t: number; v: number }[]; // t = epoch s
};

const MAX_POINTS = 120;

function thin<T>(xs: T[]): T[] {
  if (xs.length <= MAX_POINTS) return xs;
  const step = xs.length / MAX_POINTS;
  const out: T[] = [];
  for (let i = 0; i < MAX_POINTS - 1; i++) out.push(xs[Math.floor(i * step)]);
  out.push(xs[xs.length - 1]);
  return out;
}

/**
 * The Anchor Unit's fair-value path: last official close moved by the anchor's change since that close.
 * Futures don't trade every hour of the weekend, so the window is the last N hours of *available* data.
 */
export async function getFairSeries(token: string, range: Range): Promise<FairSeries | null> {
  const pair = PAIRS.find((p) => p.token === token);
  if (!pair) return null;

  const d = await loadPair(pair);
  const nowS = Date.now() / 1000;
  const sessions = toSessions(d.etf.bars);
  const completed = sessions.filter((s) => s.closeT <= nowS);
  const last = completed[completed.length - 1] ?? sessions[sessions.length - 1];
  const live = sessions[sessions.length - 1];
  const inSession = live.openT <= nowS && nowS < live.closeT;

  const fine = d.source === "live" ? await fetchChart(inSession ? pair.token : pair.anchor, "5m", "5d") : null;
  const bars = fine?.bars ?? d.anchor.bars;
  const end = bars[bars.length - 1].t;
  let window = bars.filter((b) => b.t >= end - RANGES[range] * 3600);
  if (window.length < 6) window = bars.slice(-6);

  let points: FairSeries["points"];
  if (inSession && fine) {
    points = window.map((b) => ({ t: b.t, v: b.c }));
  } else {
    const anchorAtClose = priceAt(d.anchor.bars, last.closeT) ?? window[0].c;
    points = window.map((b) => ({ t: b.t, v: last.close * (1 + pair.beta * (b.c / anchorAtClose - 1)) }));
  }

  return {
    token,
    range,
    source: d.source,
    basis: inSession && fine ? "market" : "anchor",
    lastClose: last.close,
    points: thin(points),
  };
}
