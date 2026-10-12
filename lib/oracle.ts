import { AGENTS, NEWS_TILT, type AgentId } from "./config";
import { loadAllPairs, loadFearGreed, loadGlobals, priceAt, toSessions, type PairData, type Source } from "./data";
import { getNewsScores, type NewsResult } from "./news";
import { marketStatus } from "./time";
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

  if (inSession) {
    // Wall Street is open: the real market anchors the price, guardians stand by.
    return {
      ...base,
      marketOpen: true,
      fairValue: d.etf.price,
      driftPct: (d.etf.price / last.close - 1) * 100,
      confidence: 99,
      agents: [],
      news: ns,
    };
  }

  const anchorEst = last.close * (1 + pair.beta * anchorMove);

  const gMoves = globals
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
    { id: "global", name: AGENTS.global.name, signal: `Asia/Europe avg ${pct(gMove)}`, estimate: globalEst, weight: learned.global },
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
  const confidence = Math.round(
    clamp(98 - hoursSinceClose * 0.3 - dispersionBps * 0.5 - (d.source === "simulated" ? 10 : 0), 35, 98),
  );

  return {
    ...base,
    marketOpen: false,
    fairValue: fair,
    driftPct: (fair / last.close - 1) * 100,
    confidence,
    agents,
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
