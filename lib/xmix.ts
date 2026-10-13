import "server-only";
import { getShiftReports } from "./backtest";
import { getSentoraEarn } from "./earn/sentora";
import { getHealth } from "./health";
import { latestHeadlines } from "./news";
import { getOracleSnapshot } from "./oracle";
import { getStockBoard } from "./stocks";

/**
 * The non-Q&A posts in the X agent's hourly mix. Each returns post lines, or null when its data isn't available
 * right now (the caller then moves on to the next type). Every figure comes from Nightshift's own data or, for
 * news, a quoted Yahoo Finance headline; nothing is invented, and no post claims a headline caused a move.
 */
export type MixCtx = { n: number; stamp: string }; // n = how many posts of this type came before (for rotation)

const money = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const move = (pct: number) => (Math.abs(pct) < 0.005 ? "flat" : `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)}%`);
const ago = (sec: number) => (sec < 90 ? "just now" : sec < 5400 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)}h ago`);
const live = <T extends { source: string }>(xs: T[]) => xs.filter((x) => x.source === "live");

export async function marketUpdate({ stamp }: MixCtx): Promise<string[] | null> {
  const snap = await getOracleSnapshot();
  const qs = live(snap.quotes);
  if (!qs.length) return null;
  const head = snap.market.open
    ? "US markets are open. Live:"
    : snap.market.phase === "WEEKEND"
      ? "Weekend. US markets are closed, but prices keep moving. Where these ETFs would trade right now:"
      : "US markets are closed. Where these ETFs would trade right now:";
  return [head, "", ...qs.map((q) => `${q.token}  ${money(q.fairValue)}  (${move(q.driftPct)})`), "", `vs last close · ${stamp}`];
}

export async function news({ n, stamp }: MixCtx): Promise<string[] | null> {
  const snap = await getOracleSnapshot();
  const qs = live(snap.quotes);
  if (!qs.length) return null;
  // rotate through tokens, and through each token's headlines; only use news from the last 24 hours
  for (let k = 0; k < qs.length; k++) {
    const q = qs[(n + k) % qs.length];
    const fresh = (await latestHeadlines(q.token)).filter((h) => h.at === null || Date.now() - h.at < 24 * 3_600_000);
    if (!fresh.length) continue;
    const h = fresh[Math.floor(n / qs.length) % fresh.length];
    const title = h.title.length > 150 ? `${h.title.slice(0, 147).trimEnd()}…` : h.title;
    return [`In the news (via Yahoo Finance):`, `"${title}"`, "", `Nightshift's live ${q.token} estimate: ${money(q.fairValue)}, ${move(q.driftPct)} vs last close (confidence ${q.confidence}).`, "", stamp];
  }
  return null;
}

export async function movers({ stamp }: MixCtx): Promise<string[] | null> {
  const board = await getStockBoard();
  if (!board.stocks.length) return null;
  const open = board.market.open;
  const by = (s: (typeof board.stocks)[number]) => (open ? s.dayChangePct : s.driftPct);
  const top = [...board.stocks].sort((a, b) => Math.abs(by(b)) - Math.abs(by(a))).slice(0, 4);
  return [
    open ? "Biggest movers today among the largest US stocks:" : "Markets closed. Our live estimates for the biggest movers:",
    "",
    ...top.map((s) => `${s.ticker}  ${money(open ? s.price : s.fairValue)}  (${move(by(s))})`),
    "",
    open ? `Live prices · ${stamp}` : `vs last close, from overnight futures. Not advice · ${stamp}`,
  ];
}

export async function trackRecord({ stamp }: MixCtx): Promise<string[] | null> {
  const reports = live(await getShiftReports());
  if (!reports.length) return null;
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  const opens = reports.reduce((a, r) => a + r.rows.length, 0);
  const wins = reports.reduce((a, r) => a + r.wins, 0);
  return [
    `Our track record, last ${reports[0].rows.length} market opens:`,
    "",
    ...reports.map((r) => `${r.token}: avg miss ${pct(r.avgNightshiftBps)} · frozen price ${pct(r.avgStaleBps)}`),
    "",
    `Closer than a frozen price on ${wins} of ${opens} opens · ${stamp}`,
  ];
}

export async function onchain({ stamp }: MixCtx): Promise<string[] | null> {
  const h = (await getHealth()) as { prices?: Record<string, { price: number; ageSec: number; stale: boolean }> };
  const prices = Object.entries(h.prices ?? {});
  if (!prices.length) return null;
  const newest = Math.min(...prices.map(([, p]) => p.ageSec));
  return [
    "Live on Base right now:",
    "",
    `Nightshift Oracle prices last updated ${ago(newest)}`,
    prices.map(([s, p]) => `${s} ${money(p.price)}`).join(" · "),
    "",
    "The Guardian keeper checks protected loans on every run. Contracts are public and verified.",
    "",
    stamp,
  ];
}

export async function feature({ n, stamp }: MixCtx): Promise<string[] | null> {
  const items: (() => Promise<string[] | null>)[] = [
    async () => [
      "Try Nightshift on Base with free demo tokens:",
      "",
      "1. Connect a wallet",
      "2. Get demo dSPY, dQQQ, dGLD, dIBIT",
      "3. Deposit and borrow dUSDG",
      "4. Turn on the Guardian",
      "",
      "Costs a few cents of gas. Demo assets, no real value. Link in bio.",
    ],
    async () => {
      const snap = await getOracleSnapshot();
      const q = snap.quotes.find((x) => x.token === "IBIT" && x.source === "live");
      if (!q) return null;
      return [
        "What's a \"stale price\"?",
        "",
        `When the market closes, most feeds freeze at the last trade. IBIT's last close: ${money(q.lastClose)}. Where Nightshift estimates it now: ${money(q.fairValue)} (${move(q.driftPct)}).`,
        "",
        "Loans priced on a frozen number get liquidated late, or wrongly.",
      ];
    },
    async () => [
      "Meet the Guardian.",
      "",
      "Set a safety level on your loan. If prices fall below it, the Guardian sells just enough collateral to bring the loan back to your target.",
      "",
      "If selling can't save it, it doesn't sell. It alerts you. Proven in Lean 4.",
    ],
    async () => [
      "Prove your loan is safe without showing its size.",
      "",
      "Nightshift Cloak makes a zero-knowledge proof in your browser: debt < collateral × price × LTV. Nothing else is revealed.",
      "",
      "Verified by a contract on Base.",
    ],
    async () => [
      "Can we quietly edit our past predictions?",
      "",
      "No. Every morning's call is recorded on the Algorand blockchain before the market opens. The track record is public and permanent.",
    ],
    async () => [
      "Built to plug into Morpho.",
      "",
      "Nightshift's price feed speaks Morpho Blue's format. Tested on a copy of Base against a real Morpho market: borrow to the limit works, one dollar more is refused, a price drop triggers liquidation.",
    ],
    async () => {
      const e = await getSentoraEarn().catch(() => null);
      if (!e || e.stale) return null;
      const apy = e.apyPublished?.apy ?? e.apy7d;
      if (apy == null) return null;
      return [
        "Idle stablecoins?",
        "",
        `${e.vault.name} (${e.vault.asset}, ${e.vault.chain}): ${apy.toFixed(1)}% 7-day APY${e.apyPublished ? " as published by Sentora" : ""}${e.tvl ? `, ${money(e.tvl).replace(/\.\d+$/, "")} in the vault` : ""}${e.coverActive ? ", Firelight-protected" : ""}.`,
        "",
        "See it in Nightshift's Earn panel. Variable, not guaranteed, not advice.",
      ];
    },
    async () => [
      "24 of 24.",
      "",
      "Every Nightshift safety rule (lending, the Guardian, the Oracle, private proofs) is a theorem proven by Harmonic's Aristotle and checked by Lean 4.",
      "",
      "The proof list's fingerprint is recorded on Algorand.",
    ],
  ];
  for (let k = 0; k < items.length; k++) {
    const lines = await items[(n + k) % items.length]();
    if (lines) return [...lines, "", stamp];
  }
  return null;
}
