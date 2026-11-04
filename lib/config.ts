// The ETFs Nightshift prices: the concept paper's starter set (S&P 500, Nasdaq-100, gold, silver, Bitcoin) and a wider set.

export type Pair = {
  token: string;
  name: string;
  anchor: string; // Yahoo symbol of the live 24h anchor
  anchorName: string;
  beta: number; // ETF move per 1.0 anchor move
  globalSens: number; // sensitivity to Asian/European markets
  sentimentTilt: number; // max move implied by a 50-point swing in fear & greed
  lltv: number; // Morpho liquidation LTV for this market
  // Used only when live data is unavailable.
  sim: { etf: number; anchor: number; hourlyVol: number };
};

export const PAIRS: Pair[] = [
  {
    token: "SPY",
    name: "S&P 500 ETF",
    anchor: "ES=F",
    anchorName: "S&P 500 futures",
    beta: 1,
    globalSens: 0.5,
    sentimentTilt: 0.002,
    lltv: 0.77,
    sim: { etf: 660, anchor: 6650, hourlyVol: 0.0012 },
  },
  {
    token: "QQQ",
    name: "Nasdaq-100 ETF",
    anchor: "NQ=F",
    anchorName: "Nasdaq-100 futures",
    beta: 1,
    globalSens: 0.55,
    sentimentTilt: 0.003,
    lltv: 0.77,
    sim: { etf: 590, anchor: 24500, hourlyVol: 0.0015 },
  },
  {
    token: "GLD",
    name: "Gold ETF",
    anchor: "GC=F",
    anchorName: "Gold futures",
    beta: 1,
    globalSens: 0.1,
    sentimentTilt: -0.001,
    lltv: 0.77,
    sim: { etf: 340, anchor: 3650, hourlyVol: 0.001 },
  },
  {
    // Silver: LLTV 62.5% (not the 68% first floated, which Morpho doesn't offer) from public/verified/lltv-study.json:
    // the worst close-to-open fall on record is 15.4%, so 77% leaves too little room. No sentiment tilt: the crypto
    // Fear & Greed index has no link to silver. Overnight beta measured at 1.02 (R² 0.96) over 20 nights.
    token: "SLV",
    name: "Silver ETF",
    anchor: "SI=F",
    anchorName: "Silver futures",
    beta: 1,
    globalSens: 0.1,
    sentimentTilt: 0,
    lltv: 0.625,
    sim: { etf: 48.7, anchor: 54.3, hourlyVol: 0.0018 },
  },
  {
    token: "IBIT",
    name: "Bitcoin ETF",
    anchor: "BTC-USD",
    anchorName: "Bitcoin spot",
    beta: 1,
    globalSens: 0.3,
    sentimentTilt: 0.008,
    lltv: 0.625,
    sim: { etf: 65, anchor: 115000, hourlyVol: 0.004 },
  },
  // Wider set (Nov 2026): each priced from a market that trades overnight; its overnight beta to that anchor is measured
  // from recent sessions (lib/beta.ts), so the starting beta below only matters until there's enough history.
  {
    token: "DIA",
    name: "Dow 30 ETF",
    anchor: "YM=F",
    anchorName: "Dow futures",
    beta: 1,
    globalSens: 0.45,
    sentimentTilt: 0.002,
    lltv: 0.77,
    sim: { etf: 533, anchor: 53600, hourlyVol: 0.0011 },
  },
  {
    token: "IWM",
    name: "Russell 2000 ETF",
    anchor: "RTY=F",
    anchorName: "Russell 2000 futures",
    beta: 1,
    globalSens: 0.45,
    sentimentTilt: 0.003,
    lltv: 0.77,
    sim: { etf: 284, anchor: 2870, hourlyVol: 0.0016 },
  },
  {
    token: "TLT",
    name: "20+ Year Treasury ETF",
    anchor: "ZB=F",
    anchorName: "Treasury bond futures",
    beta: 1,
    globalSens: 0.05,
    sentimentTilt: -0.001,
    lltv: 0.77,
    sim: { etf: 82, anchor: 108, hourlyVol: 0.0008 },
  },
  {
    token: "USO",
    name: "Oil ETF",
    anchor: "CL=F",
    anchorName: "Crude oil futures",
    beta: 1,
    globalSens: 0.15,
    sentimentTilt: 0.002,
    lltv: 0.625,
    sim: { etf: 145, anchor: 88.5, hourlyVol: 0.002 },
  },
  {
    token: "ETHA",
    name: "Ethereum ETF",
    anchor: "ETH-USD",
    anchorName: "Ethereum spot",
    beta: 1,
    globalSens: 0.3,
    sentimentTilt: 0.01,
    lltv: 0.625,
    sim: { etf: 54.7, anchor: 2420, hourlyVol: 0.005 },
  },
  {
    token: "GDX",
    name: "Gold Miners ETF",
    anchor: "GC=F",
    anchorName: "Gold futures",
    beta: 1.5,
    globalSens: 0.15,
    sentimentTilt: 0,
    lltv: 0.625,
    sim: { etf: 84.6, anchor: 3650, hourlyVol: 0.0018 },
  },
  {
    token: "SMH",
    name: "Semiconductor ETF",
    anchor: "NQ=F",
    anchorName: "Nasdaq-100 futures",
    beta: 1.4,
    globalSens: 0.55,
    sentimentTilt: 0.004,
    lltv: 0.625,
    sim: { etf: 504, anchor: 24500, hourlyVol: 0.002 },
  },
];

export const GLOBAL_MARKETS = [
  { symbol: "^N225", name: "Nikkei 225" },
  { symbol: "^GDAXI", name: "DAX" },
  { symbol: "^FTSE", name: "FTSE 100" },
];

// Prior weights. Anchor, global and momentum are re-fit from the track record (lib/weights.ts).
export const AGENTS = {
  anchor: { name: "Anchor signal", weight: 0.6 },
  global: { name: "Global markets signal", weight: 0.2 },
  momentum: { name: "Momentum signal", weight: 0.1 },
  sentiment: { name: "Sentiment signal", weight: 0.1 },
  news: { name: "News agent (Claude)", weight: 0.1 },
} as const;

// Max fair-value move implied by a news score of ±1.
export const NEWS_TILT: Record<string, number> = { SPY: 0.004, QQQ: 0.005, GLD: 0.003, SLV: 0.005, IBIT: 0.01, DIA: 0.004, IWM: 0.006, TLT: 0.003, USO: 0.008, ETHA: 0.012, GDX: 0.007, SMH: 0.008 };

export type AgentId = keyof typeof AGENTS;
