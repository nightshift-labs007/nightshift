import "server-only";
import fuzz from "../public/verified/guardian-fuzz.json";
import lltvStudy from "../public/verified/lltv-study.json";
import manifest from "../public/verified/manifest.json";
import slither from "../public/verified/security/slither.json";
import { ledgerAddress, readStamps } from "./algorand";
import { getShiftReports } from "./backtest";
import { DEPLOYMENT } from "./chain";
import { getSentoraEarn } from "./earn/sentora";
import { getLeaderboard } from "./leaderboard";
import { getStockBoard } from "./stocks";
import { findStocks, normalize } from "./nyx";

/**
 * Everything Nightshift knows, for Nyx's AI answers. Only the facts and live sections a question touches are sent:
 * that keeps answers fast and inside the free Groq quota (8,000 tokens a minute per model). Live sections are read
 * from the same sources as the site's pages, with a time limit so a slow source never blocks an answer.
 */
const within = <T,>(p: Promise<T>, ms = 5000): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
const f2 = (x: number) => x.toFixed(2);
const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

/** Docs facts, each sent only when the question touches it (the free tier allows 8,000 tokens a minute per model). */
const FACTS: [RegExp, string][] = [
  [/\b(oracle|fair value|signals?|weights?|how do you (price|know|calculate)|price model|futures|anchor|data source|yahoo|twelve data|where.*prices? come)\b/, "Oracle: blends four signals per ETF: its overnight anchor (S&P 500 futures for SPY, Nasdaq-100 futures for QQQ, gold futures for GLD, bitcoin for IBIT), Asia and Europe index moves, the 3-hour anchor trend, and the Fear & Greed index. Weights are learned from past market opens, never negative, always summing to 100%. Data comes from Yahoo Finance, with Twelve Data as backup; if both fail, prices are labelled simulated. The NYSE holiday and early-close calendar is built in."],
  [/\b(beta|blume|regression|r.?squared|sensitiv\w*)\b/, "Beta: ordinary least squares of each ETF's overnight move against its anchor's, Blume-adjusted (0.67 x beta + 0.33), clamped 0.5 to 1.5, from earlier nights only. Fewer than 10 nights or R-squared below 0.3 falls back to 1.0."],
  [/\b(confiden\w*|conf|sure|certain\w*|event mode)\b/, "Confidence: 98, minus 0.3 per hour since the close, minus 0.5 per basis point of signal disagreement (minus 10 for simulated data), kept between 35 and 98. Event mode caps it at 70 for a sharp move while closed (SPY and GLD 3%, QQQ 3.5%, IBIT 7%) and at 55 for twice that; stale anchor data caps it at 60. Lower confidence shrinks borrow limits."],
  [/\b(keeper|update\w*|how often|every \d+|cron|push\w*)\b/, "Keeper: runs every 10 minutes and pushes a price on-chain when it moved more than 0.1% or is over 10 minutes old. One update can move a price at most 15%; bigger moves need the owner. If price updates stop, on-chain confidence decays 1 point an hour, new borrowing stops below 40, and the Vault refuses prices older than 2 days."],
  [/\b(vault|borrow\w*|loan\w*|lend\w*|collateral|debt|health|lltv|liquidat\w*|dusdg|usdg|repay\w*)\b/, "Vault (Base, demo tokens, unaudited): LLTV 77% for SPY, QQQ and GLD, 62.5% for IBIT. Borrow limit = collateral x price x LLTV x (1 - (100 - confidence)/200); no new borrowing below confidence 40. Health factor = what the collateral supports divided by debt; below 1 anyone can liquidate, with a bonus of min(15%, 1/(0.3 x LLTV + 0.7) - 1), about 7.4% at 77% and 12.7% at 62.5%. Loans are in dUSDG. Every state-changing function has a re-entrancy guard."],
  [/\b(guardian|protect\w*|trigger|target|auto|rebalanc\w*|alerts?)\b/, "Guardian: the borrower sets a trigger and a target health factor (for example 1.10 and 1.40). The keeper checks every 10 minutes; below the trigger it sells just enough collateral to the Vault, at the oracle price minus 0.5%, to reach the target. If selling can't help it only alerts. Alerts show in the app and as browser notifications while the page is open; email and Telegram alerts are planned. If the keeper is offline, loans below health 1 can be liquidated by anyone."],
  [/\b(cloak|zero.?knowledge|zk|groth16|privacy|private|solven\w*|zkproof|circuit)\b/, "Cloak: a Groth16 zero-knowledge proof (918 constraints) that debt x 1e8 < units x price x LLTV, meaning health above 1 at that price, without revealing the amounts; it outputs a commitment to the hidden numbers. The server checks its price is within 0.5% of the oracle; CloakRegistry on Base checks within 1%, from a price under a day old, and attest() records a passing proof on-chain. It proves solvency, not a specific health factor."],
  [/\b(api|endpoint\w*|developer\w*|integrat\w*|feed\w*|chainlink|morpho|consume|build on)\b/, "Public API: GET /api/v1/prices, /api/v1/prices/{token}, /api/v1/history?token=SPY&range=12H, /api/v1/track-record; 60 uncached requests a minute per IP. On-chain: Chainlink-style feeds (8 decimals, latestRoundData, plus confidence()) and Morpho Blue oracles (1e36 scale, refuse prices over a day old). The Vault follows Morpho Blue's rules; live Morpho markets are not created yet (the script is ready)."],
  [/\b(how (do|can) i|get started|start|try|use (it|this|nightshift)|demo tokens?|faucet|paper|wallet|connect|test)\b/, "Trying it: the App has a paper account (no wallet; starts with 10 SPY, 10 QQQ, 20 GLD, 200 IBIT) or a wallet mode on Base, where Get demo tokens gives the same amounts plus a little gas ETH, once a day per address, after a free signature. Then deposit collateral, borrow dUSDG, and set a Guardian rule. Demo tokens have no value."],
  [/\b(profile|account|email|sign ?in|log ?in|name)\b/, "Profiles (/profile): sign in with a free wallet signature (lasts 7 days); add a name, email, X, Telegram, website and bio. Email, Telegram and website stay private; name and X show on the leaderboard only if allowed. Profiles can be edited or deleted. The profile page shows points, rank and how to earn more."],
  [/\b(open source|github|code|repo\w*|license|contribut\w*|twitter|x account|social)\b/, "Open source: github.com/nightshift-labs007/nightshift (Apache 2.0, contributions welcome); the proofs are at github.com/nightshift-labs007/nightshift-formal. Nightshift's X account is @nightshift_si."],
  [/\b(roadmap|next|future|plan\w*|coming|missing|not (done|built)|limitation\w*|production|real money)\b/, "Not done yet: an independent audit (the audit scope is written), live Morpho Blue markets (oracles are live, the market script is ready), a multisig and timelock for owner powers, and email/Telegram alerts. Everything uses demo tokens with no value."],
];

type Section = { re: RegExp; build: (question: string) => Promise<string | null> };

const SECTIONS: Section[] = [
  {
    // individual stocks on the homepage stock board
    re: /\b(stocks?|shares?|equit\w*|compan\w*|apple|aapl|nvidia|nvda|microsoft|msft|tesla|tsla|alphabet|google|amazon|amzn|meta|facebook|broadcom|tsmc|berkshire|jp ?morgan|lilly|visa|mastercard|oracle corp|netflix|amd|walmart|costco|exxon|ticker|nasdaq stocks|big tech|magnificent)\b/,
    build: async (question) => {
      const b = await within(getStockBoard());
      if (!b?.stocks?.length) return null;
      // just the companies asked about, when the question names some; the whole board otherwise
      const named = new Set(findStocks(normalize(question)));
      const rows = named.size ? b.stocks.filter((s) => named.has(s.ticker)) : b.stocks;
      return `Stock board (homepage "Top stocks", ${b.stocks.length} stocks: ${b.stocks.map((s) => s.name).join(", ")}. Nightshift prices them overnight from index futures and each stock's measured beta; ${b.market.open ? "market open" : "market closed"}, ${b.market.etTime}):\n${rows
        .map((s) => `${s.ticker} ${s.name} (${s.sector}): last close $${f2(s.lastClose)}${s.marketOpen ? `, trading $${f2(s.price)} (${sign(s.dayChangePct)} today)` : ""}, fair value $${f2(s.fairValue)} (${sign(s.driftPct)} vs close), confidence ${s.confidence}${s.extended ? `, latest extended-hours trade $${f2(s.extended.price)}` : ""}, 1-month ${sign(s.ret1mPct)}, 3-month ${sign(s.ret3mPct)}`)
        .join("\n")}${b.missing?.length ? `\nUnavailable right now: ${b.missing.join(", ")}.` : ""}\nNightshift does not cover other stocks or crypto directly.`;
    },
  },
  {
    re: /\b(accura\w*|track record|graded|predict\w*|ledger|algorand|miss\w*|how (good|right)|hit rate|backtest|frozen)\b/,
    build: async () => {
      const [rep, stamps] = await Promise.all([within(getShiftReports()), within((async () => { const a = ledgerAddress(); return a ? readStamps(a, 5) : null; })())]);
      const parts: string[] = [];
      if (rep?.length) parts.push(`Track record (last ${rep[0].rows.length} opens, predicted open vs a frozen last close):\n${rep.map((r) => `${r.token}: average miss ${f2(r.avgNightshiftBps / 100)}% vs frozen ${f2(r.avgStaleBps / 100)}%, closer on ${r.wins} of ${r.rows.length}`).join("\n")}`);
      if (stamps?.length) parts.push(`Latest predictions locked on Algorand: ${stamps.slice(0, 3).map((s) => `${s.session} (locked ${new Date(s.roundTime * 1000).toISOString().slice(11, 16)} UTC): ${Object.entries(s.p).map(([k, v]) => `${k} $${f2(v)}`).join(", ")}`).join("; ")}.`);
      return parts.join("\n") || null;
    },
  },
  {
    re: /\b(leader ?board|rank\w*|points?|top (users|wallets|players)|who.?s (top|winning|first)|how many (users|wallets|people))\b/,
    build: async () => {
      const b = await within(getLeaderboard());
      if (!b) return null;
      return `Leaderboard: ${b.totals.wallets} wallets, ${b.totals.joined} joined, ${b.totals.depositors} deposited, ${b.totals.borrowers} borrowing now, ${b.totals.guardians} with the Guardian on. Top: ${b.rows.slice(0, 5).map((r) => `#${r.rank} ${r.name ?? `wallet ${r.address.slice(0, 6)}…${r.address.slice(-4)}`} ${r.points} points`).join("; ")}.`;
    },
  },
  {
    re: /\b(contracts?|address\w*|deploy\w*|basescan|sourcify|verified on|chain ?link|aggregator|adapter|on.?chain|smart contract|base (mainnet|chain)|chain id)\b/,
    build: async () => {
      const d = DEPLOYMENT;
      const c = d.contracts;
      return `Contracts on ${d.chainName} (chain ${d.chainId}), all source-verified on Sourcify: Oracle ${c.oracle}, Vault ${c.vault}, dUSDG loan token ${c.usdg}, Groth16 verifier ${c.verifier}${c.cloakRegistry ? `, CloakRegistry ${c.cloakRegistry}` : ""}. Tokens: ${Object.entries(d.tokens).map(([s, t]) => `d${s} ${t.address} (LLTV ${t.lltv * 100}%, Morpho oracle ${t.adapter}${t.feed ? `, Chainlink-style feed ${t.feed}` : ""})`).join("; ")}. Explorer: ${d.explorer}. The owner is a single wallet (no multisig yet); ownership was not transferred.`;
    },
  },
  {
    re: /\b(proofs?|proven|lean|harmonic|aristotle|theorem|formal\w*|mathematic\w*|guarantee\w*|properties)\b/,
    build: async () =>
      `Machine-proven properties (Lean 4, checked by Harmonic's Aristotle; ${manifest.properties.filter((p) => p.status === "verified").length} verified, manifest hash anchored on Algorand):\n${manifest.properties.map((p) => `${p.id} (${p.module}): ${p.plain}`).join("\n")}`,
  },
  {
    re: /\b(audit\w*|slither|secur\w*|hack\w*|fuzz\w*|bugs?|vulnerab\w*|risks?|safe(ty)?|trust\w*|exploit\w*)\b/,
    build: async () =>
      `Security: no independent audit yet (contracts are an unaudited demo). Slither static analysis: ${slither.summary} Guardian fuzzing: ${fuzz.stats.steps.toLocaleString("en-US")} random price moves across ${fuzz.scenarios} loans, ${fuzz.violationCount} invariant violations (${fuzz.passed ? "passed" : "failed"}). Trust: one owner wallet can force-set prices and change markets; there is no timelock or pause yet. An audit scope document lists these.`,
  },
  {
    re: /\b(lltv|ltv|liquidat\w*|gaps?|weekend|overnight jump|risk param\w*|collateral factor|bad debt)\b/,
    build: async () => {
      const s = lltvStudy as { tokens: { token: string; currentLltv: number; history: { worstFallPct: number; worst: { date: string }[]; p99FallPct: number }; recommended: { frozenFullHistory: number | null }; nightshiftWindow: { frozen: { meanAbsPct?: number }; nightshift: { meanAbsPct?: number } } }[]; morphoTokenizedMarkets: { collateral: string; lltv: number }[] };
      return `LLTV study (every close-to-open gap since 2005): ${s.tokens.map((t) => `${t.token}: worst fall at the open ${t.history.worstFallPct}% (${t.history.worst[0]?.date}), 1-in-100 nights ${t.history.p99FallPct}%, current LLTV ${t.currentLltv * 100}%, supported with a 1.5x margin on a frozen price: ${t.recommended.frozenFullHistory ? `${t.recommended.frozenFullHistory * 100}%` : "none"}; average jump frozen ${t.nightshiftWindow.frozen.meanAbsPct}% vs Nightshift ${t.nightshiftWindow.nightshift.meanAbsPct}%`).join(". ")}. IBIT's 62.5% relies on Nightshift tracking bitcoin overnight. Live Morpho tokenized-stock markets mostly use 62.5%, some 86% and 38.5%.`;
    },
  },
  {
    re: /\b(earn|yield|sentora|apy|pyusd|interest rate|staking|passive income|savings)\b/,
    build: async () => {
      const e = await within(getSentoraEarn());
      if (!e) return "Earn: a read-only view of a Sentora PYUSD vault, with deposits on Sentora's own site. Live data unavailable right now.";
      const apy = e.apyPublished?.apy ?? e.apy7d;
      return `Earn (Sentora, third party): vault ${e.vault.name} on ${e.vault.chain}, asset ${e.vault.asset}; headline APY ${apy != null ? `${f2(apy)}%` : "unavailable"}${e.apyPublished ? ` (Sentora's published 7-day figure as of ${e.apyPublished.asOf})` : ""}${e.apy30d != null ? `, 30-day ${f2(e.apy30d)}%` : ""}${e.tvl != null ? `, size about $${Math.round(e.tvl).toLocaleString("en-US")}` : ""}. Deposits happen on Sentora's site; Nightshift never holds funds.`;
    },
  },
];

/** The docs facts and live sections this question (and the turn before it) touches. */
export async function knowledge(text: string): Promise<string> {
  const t = text.toLowerCase();
  const facts = FACTS.filter(([re]) => re.test(t)).map(([, f]) => `- ${f}`);
  const built = await Promise.all(SECTIONS.filter((s) => s.re.test(t)).map((s) => s.build(t).catch(() => null)));
  return [facts.length ? `Relevant facts from the Docs:\n${facts.join("\n")}` : "", ...built].filter(Boolean).join("\n\n");
}
