import type { Quote } from "./oracle";

/**
 * The 24 proven properties, written for people rather than mathematicians: a question, the short answer,
 * one plain formula, and the rule checked on live Oracle numbers. Each card restates its Lean theorem
 * (formal/Nightshift/*.lean); if a statement changes there, change it here too. Formulas mirror the contracts:
 * health = c·p·L / d, borrow limit = c·p·L·(1 − (100 − conf)/200), bonus = min(15%, 1/(0.3·L + 0.7) − 1).
 */
export type TheoremCtx = { q: Quote; quotes: Quote[] };
export type Card = { id: string; ask: string; answer: string; formula: string[]; live?: (c: TheoremCtx) => string };

const $ = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $0 = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const n2 = (x: number) => x.toFixed(2);
const haircut = (conf: number) => 1 - (100 - conf) / 200;
const bonusPct = (L: number) => (Math.min(1.15, 1 / (0.3 * L + 0.7)) - 1) * 100;

// a sample loan: 10 shares at the live fair value, borrowed so its health is 1.25
function loan({ q }: TheoremCtx) {
  const c = 10, p = q.fairValue, L = q.lltv;
  const d = (c * p * L) / 1.25;
  return { c, p, L, d, health: (c * p * L) / d };
}
// Guardian example: health 1.10, target 1.40, 0.5% slippage
function guardian({ q }: TheoremCtx) {
  const C = 10, p = q.fairValue, L = q.lltv, s = 0.005, T = 1.4;
  const D = (C * p * L) / 1.1;
  const sell = (T * D - L * p * C) / (p * (T * (1 - s) - L));
  const after = (c: number) => ((C - c) * p * L) / (D - c * p * (1 - s));
  return { C, T, sell, after };
}
const confs = (quotes: Quote[]) => quotes.map((q) => `${q.token} ${q.confidence}`).join(" · ");

export const CARDS: Card[] = [
  {
    id: "V1",
    ask: "Can a healthy loan on Nightshift get liquidated?",
    answer: "No. Never.",
    formula: ["health = collateral × price × LTV ÷ debt", "health ≥ 1 ⟹ no liquidation"],
    live: (x) => { const l = loan(x); return `Now: 10 ${x.q.token} at ${$(l.p)}, ${$0(l.d)} borrowed → health ${n2(l.health)}. Safe.`; },
  },
  {
    id: "V0",
    ask: "When exactly is a loan \"healthy\"?",
    answer: "When the debt fits under the collateral's borrowing power. Nothing else.",
    formula: ["debt ≤ collateral × price × LTV"],
    live: (x) => { const l = loan(x); return `Now: ${$0(l.d)} debt ≤ ${$0(l.c * l.p * l.L)} borrowing power on 10 ${x.q.token}.`; },
  },
  {
    id: "V2",
    ask: "Can a price going UP ever hurt your loan?",
    answer: "No.",
    formula: ["higher price ⟹ higher health"],
    live: (x) => { const l = loan(x); return `Now: 10 ${x.q.token}, health ${n2(l.health)}. If ${x.q.token} rises 1% → ${n2(l.health * 1.01)}.`; },
  },
  {
    id: "V3",
    ask: "Can adding collateral ever make a loan riskier?",
    answer: "No.",
    formula: ["more collateral ⟹ higher health"],
    live: (x) => { const l = loan(x); return `Now: 10 ${x.q.token} → health ${n2(l.health)}. Add 1 more → ${n2(l.health * 1.1)}.`; },
  },
  {
    id: "V4",
    ask: "Can paying back part of a loan ever make it riskier?",
    answer: "No.",
    formula: ["less debt ⟹ higher health"],
    live: (x) => { const l = loan(x); return `Now: a ${x.q.token} loan at health ${n2(l.health)}. Repay 20% → ${n2(l.health / 0.8)}.`; },
  },
  {
    id: "V5",
    ask: "Can rounding errors make a risky loan look safe?",
    answer: "No. The Vault always rounds against the borrower, so \"healthy\" on-chain means healthy in exact math too.",
    formula: ["rounded health ≤ exact health"],
  },
  {
    id: "V6",
    ask: "How much extra can a liquidator take from you?",
    answer: "At most 15%. Hard-capped.",
    formula: ["liquidation bonus ≤ 15%"],
    live: ({ quotes }) => `Now: ${quotes.map((q) => `${q.token} ${bonusPct(q.lltv).toFixed(1)}%`).join(" · ")}`,
  },
  {
    id: "V7",
    ask: "If you borrow up to Nightshift's limit, is the loan safe?",
    answer: "Yes. Always.",
    formula: ["borrow ≤ limit ⟹ healthy", "limit shrinks when price confidence drops"],
    live: ({ q }) => `Now: 10 ${q.token} (confidence ${q.confidence}) → you can borrow up to ${$0(10 * q.fairValue * q.lltv * haircut(q.confidence))}.`,
  },
  {
    id: "G1",
    ask: "Can the Guardian ever do something weird, like take a negative amount of collateral?",
    answer: "No. It always uses zero or more.",
    formula: ["collateral used ≥ 0"],
    live: (x) => { const g = guardian(x); return `Now: a 10 ${x.q.token} loan at health 1.10 → Guardian uses ${g.sell.toFixed(2)} ${x.q.token} to repay, reaching 1.40.`; },
  },
  {
    id: "G2",
    ask: "Can the Guardian use more collateral than you own?",
    answer: "No.",
    formula: ["collateral used ≤ your collateral"],
    live: (x) => { const g = guardian(x); return `Now: it would use ${g.sell.toFixed(2)} of your ${g.C} ${x.q.token}.`; },
  },
  {
    id: "G3",
    ask: "When the Guardian rescues a loan, where does it land?",
    answer: "Exactly on the safety level you chose. Not a guess.",
    formula: ["health after rebalancing = your target"],
    live: (x) => { const g = guardian(x); return `Now: ${x.q.token} loan at 1.10, target 1.40 → use ${g.sell.toFixed(2)} → health ${g.after(g.sell).toFixed(2)}.`; },
  },
  {
    id: "G3b",
    ask: "Does the Guardian use more collateral than it needs to?",
    answer: "No. Any smaller amount would miss your target.",
    formula: ["less collateral used ⟹ below target"],
    live: (x) => { const g = guardian(x); return `Now: using 10% less ${x.q.token} would only reach ${g.after(g.sell * 0.9).toFixed(2)}, not ${n2(g.T)}.`; },
  },
  {
    id: "G4",
    ask: "What if using collateral can't save the loan?",
    answer: "Then the Guardian doesn't touch it. It flags the loan in the app instead of making it worse.",
    formula: ["can't help ⟹ no action, alert"],
  },
  {
    id: "G5",
    ask: "Which loans does the Guardian step in for?",
    answer: "Only ones that rebalancing can still save.",
    formula: ["Guardian acts ⟹ loan is still savable"],
  },
  {
    id: "O1",
    ask: "Can Nightshift's price ever go outside what the market signals say?",
    answer: "No. It always lands between the lowest and highest signal.",
    formula: ["lowest signal ≤ Nightshift price ≤ highest signal"],
    live: ({ q }) => {
      const xs = q.agents.filter((a) => a.weight > 0).map((a) => a.estimate);
      return `Now, ${q.token}: ${$(Math.min(...xs))} ≤ ${$(q.fairValue)} ≤ ${$(Math.max(...xs))}`;
    },
  },
  {
    id: "O1a",
    ask: "How does Nightshift combine its price signals?",
    answer: "A weighted average. Weights are never negative and always add up to 100%.",
    formula: ["weights ≥ 0 · weights sum to 100%"],
    live: ({ q }) => `Now, ${q.token}: ${q.agents.filter((a) => a.weight > 0).map((a) => `${Math.round(a.weight * 100)}%`).join(" + ")} = 100%`,
  },
  {
    id: "O1b",
    ask: "Nightshift re-weights its signals by past accuracy. Can that go wrong?",
    answer: "Not in a way that breaks the math: weights stay positive and the total stays the same.",
    formula: ["learned weights ≥ 0", "total weight unchanged"],
    live: ({ q }) => `Now: ${q.token} weights learned from ${q.learned?.sessions ?? 0} graded market opens.`,
  },
  {
    id: "O2",
    ask: "Does Nightshift get more confident the longer markets stay closed?",
    answer: "Never. Confidence only goes down while markets are shut.",
    formula: ["longer closed ⟹ lower confidence"],
    live: ({ quotes }) => `Confidence now: ${confs(quotes)}`,
  },
  {
    id: "O2b",
    ask: "What happens when Nightshift's signals disagree?",
    answer: "Confidence drops. More disagreement never raises it.",
    formula: ["more disagreement ⟹ lower confidence"],
    live: ({ quotes }) => `Confidence now: ${confs(quotes)}`,
  },
  {
    id: "O3",
    ask: "How confident can Nightshift's price ever be?",
    answer: "Always between 35 and 98 out of 100. Never 100%, never zero.",
    formula: ["35 ≤ confidence ≤ 98"],
    live: ({ quotes }) => `Now: ${confs(quotes)}`,
  },
  {
    id: "C1",
    ask: "Can someone fake a private solvency proof by overflowing the numbers?",
    answer: "No. The numbers that go in are bounded far below where overflow could happen.",
    formula: ["biggest input product < 2¹¹⁸", "overflow starts near 2²⁵³"],
  },
  {
    id: "C1b",
    ask: "What about the debt side of a private proof?",
    answer: "Same guarantee: it can't overflow either.",
    formula: ["debt input < 2¹²⁰, far from overflow"],
  },
  {
    id: "C2",
    ask: "Is the math inside a zero-knowledge proof the same as normal math?",
    answer: "For Nightshift's numbers, yes. Nothing wraps around.",
    formula: ["circuit math = normal math (in range)"],
  },
  {
    id: "C4",
    ask: "Private proofs use rounded numbers. Can rounding make a bad loan pass?",
    answer: "No. Collateral rounds down, debt rounds up, so a passing proof means the real loan is solvent.",
    formula: ["proof passes ⟹ real loan is safe"],
  },
];
