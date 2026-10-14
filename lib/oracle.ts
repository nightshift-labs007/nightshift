import { overnightBeta, type BetaEstimate } from "./beta";
import { AGENTS, NEWS_TILT, type AgentId } from "./config";
import { loadAllPairs, loadFearGreed, loadGlobals, priceAt, toSessions, type PairData, type Source } from "./data";
import { getNewsScores, type NewsResult } from "./news";
import { etParts, marketStatus } from "./time";
import { learnWeights, type Learned } from "./weights";

export type AgentReading = { id: AgentId; name: string; signal: string; estimate: number; weight: number };

export type Quote = {
  token: string;
  name: string;
  anchorName: string;
  lltv: number;
  source: Source;
  marketOpen: boolean;
  lastClose: number;
  lastCloseAt: string;
  fairValue: number;
  driftPct: number; // fair value vs the stale last close
  confidence: number; // 0-100
  anchorMovePct: number;
  agents: AgentReading[];
  /** measured overnight beta to the anchor (falls back to 1.0 with few sessions or a weak fit) */
  beta?: BetaEstimate;
  /** reasons confidence was capped: a sharp move while closed (event mode) or stale anchor data */
  flags?: string[];
  learned?: { sessions: number };
  news?: { score: number; reason: string; headlines: string[] } | null;
};

export type OracleSnapshot = {
  updatedAt: string;
  market: ReturnType<typeof marketStatus>;
  fearGreed: { value: number; previous: number; label: string } | null;
  quotes: Quote[];
  newsAgent: { enabled: boolean; model?: string; at?: string };
};

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Futures (ES, NQ, GC) trade Sun 18:00 – Fri 17:00 New York time, with a daily 17:00–18:00 break. Bitcoin never stops. */
function anchorShouldTrade(symbol: string, nowMs: number) {
  if (symbol === "BTC-USD") return true;
  const p = etParts(nowMs);
  if (p.weekday === "Sat") return false;
  if (p.weekday === "Sun") return p.hour >= 18;
  if (p.weekday === "Fri") return p.hour < 17;
  return p.hour !== 17;
}
const STALE_ANCHOR_HOURS = 2; // no anchor bar for this long while it should be trading → stale
const STALE_GLOBAL_HOURS = 96; // a foreign market with no bar for 4 days (longer than any weekend) is dropped
// Event mode: a sharp move while the market is closed (fair value vs last close). Thresholds per asset volatility.
const EVENT_MOVE_PCT: Record<string, number> = { SPY: 3, QQQ: 3.5, GLD: 3, IBIT: 7 };
const EVENT_CAP = 70; // confidence cap at the threshold…
const SEVERE_EVENT_CAP = 55; // …and at twice the threshold
const STALE_CAP = 60;

function computeQuote(
  d: PairData,
  globals: Awaited<ReturnType<typeof loadGlobals>>,
  fg: OracleSnapshot["fearGreed"],
  nowS: number,
  marketOpen: boolean,
  learned: Learned,
  news: NewsResult | null,
): Quote {
  const { pair } = d;
  const sessions = toSessions(d.etf.bars);
  const completed = sessions.filter((s) => s.closeT <= nowS);
  const last = completed[completed.length - 1] ?? sessions[sessions.length - 1];
  const live = sessions[sessions.length - 1];
  const inSession = marketOpen && live.openT <= nowS && nowS < live.closeT;

  const anchorNow = d.anchor.price;
  const anchorAtClose = priceAt(d.anchor.bars, last.closeT) ?? anchorNow;
  const anchorMove = anchorNow / anchorAtClose - 1;

  const base = {
    token: pair.token,
    name: pair.name,
    anchorName: pair.anchorName,
    lltv: pair.lltv,
    source: d.source,
    lastClose: last.close,
    lastCloseAt: new Date(last.closeT * 1000).toISOString(),
    anchorMovePct: anchorMove * 100,
    learned: { sessions: learned.sessions },
  };
  const ns = news?.scores.find((x) => x.token === pair.token) ?? null;
  // overnight beta measured from completed sessions (Blume-adjusted; 1.0 when there are few sessions or R² < 0.3)
  const beta = overnightBeta(completed, d.anchor.bars);

  if (inSession) {
    // Wall Street is open: the real market anchors the price, guardians stand by.
    return {
      ...base,
      marketOpen: true,
      fairValue: d.etf.price,
      driftPct: (d.etf.price / last.close - 1) * 100,
      confidence: 99,
      agents: [],
      beta,
      flags: [],
      news: ns,
    };
  }

  const anchorEst = last.close * (1 + beta.value * anchorMove);

  const flags: string[] = [];
  const lastAnchorT = d.anchor.bars[d.anchor.bars.length - 1]?.t ?? 0;
  const anchorAgeH = (nowS - lastAnchorT) / 3600;
  const anchorStale = d.source === "live" && anchorShouldTrade(pair.anchor, nowS * 1000) && anchorAgeH > STALE_ANCHOR_HOURS;
  if (anchorStale) flags.push(`${pair.anchorName} data is ${anchorAgeH.toFixed(1)}h old`);

  // freshness: a foreign market whose data stopped updating drops out of the global signal
  const gMoves = globals
    .filter((g) => (nowS - (g.chart.bars[g.chart.bars.length - 1]?.t ?? 0)) / 3600 <= STALE_GLOBAL_HOURS)
    .map((g) => {
      const then = priceAt(g.chart.bars, last.closeT);
      return then ? g.chart.price / then - 1 : NaN;
    })
    .filter(Number.isFinite);
  const gMove = gMoves.length ? gMoves.reduce((a, b) => a + b, 0) / gMoves.length : 0;
  const globalEst = last.close * (1 + pair.globalSens * gMove);

  const a3h = priceAt(d.anchor.bars, nowS - 3 * 3600) ?? anchorNow;
  const mom = anchorNow / a3h - 1;
  const momentumEst = anchorEst * (1 + 0.25 * mom);

  const fgDelta = fg ? fg.value - fg.previous : 0;
  const sentimentEst = anchorEst * (1 + (pair.sentimentTilt * fgDelta) / 50);

  const agents: AgentReading[] = [
    { id: "anchor", name: AGENTS.anchor.name, signal: `${pair.anchorName} ${pct(anchorMove)} since close`, estimate: anchorEst, weight: learned.anchor },
    { id: "global", name: AGENTS.global.name, signal: gMoves.length ? `Asia/Europe avg ${pct(gMove)}` : "no fresh data", estimate: globalEst, weight: gMoves.length ? learned.global : 0 },
    { id: "momentum", name: AGENTS.momentum.name, signal: `3h anchor trend ${pct(mom)}`, estimate: momentumEst, weight: learned.momentum },
    {
      id: "sentiment",
      name: AGENTS.sentiment.name,
      signal: fg ? `Fear & Greed ${fg.value} (${fgDelta >= 0 ? "+" : ""}${fgDelta})` : "feed offline",
      estimate: sentimentEst,
      weight: fg ? AGENTS.sentiment.weight : 0,
    },
  ];
  if (ns) {
    agents.push({
      id: "news",
      name: AGENTS.news.name,
      signal: `score ${ns.score >= 0 ? "+" : ""}${ns.score.toFixed(2)} · ${ns.reason}`,
      estimate: anchorEst * (1 + (NEWS_TILT[pair.token] ?? 0.004) * ns.score),
      weight: AGENTS.news.weight,
    });
  }

  const wSum = agents.reduce((a, x) => a + x.weight, 0);
  for (const a of agents) a.weight = a.weight / wSum;
  const fair = agents.reduce((a, x) => a + x.weight * x.estimate, 0);
  const dispersionBps = (Math.sqrt(agents.reduce((a, x) => a + x.weight * (x.estimate - fair) ** 2, 0)) / fair) * 1e4;
  const hoursSinceClose = (nowS - last.closeT) / 3600;
  // the proven formula (formal/Nightshift/Oracle.lean: O2, O2b, O3)…
  const proven = Math.round(clamp(98 - hoursSinceClose * 0.3 - dispersionBps * 0.5 - (d.source === "simulated" ? 10 : 0), 35, 98));
  // …then caps that can only lower it and stay ≥ 35, so O2, O2b and O3 still hold:
  // event mode (a sharp move while closed) and stale anchor data
  let cap = 98;
  const movePct = Math.abs(fair / last.close - 1) * 100;
  const threshold = EVENT_MOVE_PCT[pair.token] ?? 3;
  if (movePct >= threshold) {
    cap = Math.min(cap, movePct >= 2 * threshold ? SEVERE_EVENT_CAP : EVENT_CAP);
    flags.push(`event mode: ${movePct.toFixed(1)}% move while the market is closed`);
  }
  if (anchorStale) cap = Math.min(cap, STALE_CAP);
  const confidence = Math.min(proven, cap);

  return {
    ...base,
    marketOpen: false,
    fairValue: fair,
    driftPct: (fair / last.close - 1) * 100,
    confidence,
    agents,
    beta,
    flags,
    news: ns,
  };
}

export async function getOracleSnapshot(): Promise<OracleSnapshot> {
  const [pairs, globals, fearGreed, news] = await Promise.all([loadAllPairs(), loadGlobals(), loadFearGreed(), getNewsScores()]);
  const market = marketStatus();
  const nowS = Date.now() / 1000;
  return {
    updatedAt: new Date().toISOString(),
    market,
    fearGreed,
    quotes: pairs.map((p) => computeQuote(p, globals, fearGreed, nowS, market.open, learnWeights(p, globals, p.pair.globalSens, p.pair.beta), news)),
    newsAgent: news ? { enabled: true, model: news.model, at: news.at } : { enabled: false },
  };
}
