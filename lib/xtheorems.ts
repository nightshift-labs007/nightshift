import type { Quote } from "./oracle";

/**
 * The 24 proven properties for the X agent: each card states the Lean theorem (formal/Nightshift/*.lean, same
 * hypotheses and conclusion with shorter names) and then evaluates it on live Oracle numbers. If a statement
 * changes in Lean, change it here too. Formulas mirror the contracts: value = c·p, HF = c·p·L / d,
 * haircut = 1 − (100 − conf)/200, borrowLimit = c·p·L·haircut, LIF = min(1.15, 1 / (0.3·L + 0.7)).
 */
export type TheoremCtx = { q: Quote; quotes: Quote[] };
type Card = { id: string; math: string[]; live?: (c: TheoremCtx) => string[] };

const $ = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n2 = (x: number) => x.toFixed(2);
const n3 = (x: number) => x.toFixed(3);
const haircut = (conf: number) => 1 - (100 - conf) / 200;
const lif = (L: number) => Math.min(1.15, 1 / (0.3 * L + 0.7));
const pctL = (L: number) => `${(L * 100).toFixed(1).replace(/\.0$/, "")}%`;

// a sample loan of 10 units at the live fair value, sized to a health factor of 1.25
function loan({ q }: TheoremCtx) {
  const c = 10, p = q.fairValue, L = q.lltv;
  const d = (c * p * L) / 1.25;
  return { c, p, L, d, hf: (c * p * L) / d };
}
// Guardian example: HF 1.10, target T = 1.40, slippage s = 0.5%
function guardian({ q }: TheoremCtx) {
  const C = 10, p = q.fairValue, L = q.lltv, s = 0.005, T = 1.4;
  const D = (C * p * L) / 1.1;
  const sell = (T * D - L * p * C) / (p * (T * (1 - s) - L));
  const after = (c: number) => ((C - c) * p * L) / (D - c * p * (1 - s));
  return { C, p, L, s, T, D, sell, after, hf: (C * p * L) / D };
}

export const CARDS: Card[] = [
  {
    id: "V0",
    math: ["healthy ⟺ d = 0 ∨ d ≤ c·p·L"],
    live: (x) => { const l = loan(x); return [`${x.q.token}: d = ${$(l.d)} ≤ c·p·L = ${$(l.c * l.p * l.L)} ✓`]; },
  },
  {
    id: "V1",
    math: ["healthy(c,p,L,d) ⟹ ¬ liquidatable(c,p,L,d)"],
    live: (x) => { const l = loan(x); return [`10 ${x.q.token} @ ${$(l.p)}, L ${pctL(l.L)}: HF = ${n2(l.hf)} ≥ 1 ⟹ safe`]; },
  },
  {
    id: "V2",
    math: ["p₁ ≤ p₂ ∧ healthy(p₁) ⟹ healthy(p₂)"],
    live: (x) => { const l = loan(x); return [`${x.q.token}: HF(${$(l.p)}) = ${n2(l.hf)} → HF(+1%) = ${n2(l.hf * 1.01)}`]; },
  },
  {
    id: "V3",
    math: ["c₁ ≤ c₂ ∧ healthy(c₁) ⟹ healthy(c₂)"],
    live: (x) => { const l = loan(x); return [`${x.q.token}: HF(c = 10) = ${n2(l.hf)} → HF(c = 11) = ${n2(l.hf * 1.1)}`]; },
  },
  {
    id: "V4",
    math: ["d₁ ≤ d₂ ∧ healthy(d₂) ⟹ healthy(d₁)"],
    live: (x) => { const l = loan(x); return [`${x.q.token}: repay 20% ⟹ HF ${n2(l.hf)} → ${n2(l.hf / 0.8)}`]; },
  },
  {
    id: "V5",
    math: ["healthy(c,p,L,d) ⟹ WAD²·d ≤ c·p·L", "(integer rounding never flatters a loan)"],
  },
  {
    id: "V6",
    math: ["L ≤ 1 ⟹ 1 ≤ LIF(L) ≤ 1.15", "LIF(L) = min(1.15, 1/(0.3L + 0.7))"],
    live: ({ quotes }) => [quotes.map((q) => `${q.token} ${n3(lif(q.lltv))}`).join(" · ") + " ✓"],
  },
  {
    id: "V7",
    math: ["d ≤ borrowLimit(c,p,L,conf) ⟹ healthy", "borrowLimit = c·p·L·(1 − (100−conf)/200)"],
    live: ({ q }) => [`10 ${q.token}, conf ${q.confidence}: limit = ${$(10 * q.fairValue * q.lltv * haircut(q.confidence))}`],
  },
  {
    id: "G1",
    math: ["sell = (T·D − L·p·C) / (p·(T(1−s) − L))", "⟹ 0 ≤ sell"],
    live: (x) => { const g = guardian(x); return [`${x.q.token}, HF ${n2(g.hf)} → T ${n2(g.T)}: sell = ${n3(g.sell)} ≥ 0 ✓`]; },
  },
  {
    id: "G2",
    math: ["sell = (T·D − L·p·C) / (p·(T(1−s) − L))", "⟹ sell ≤ C"],
    live: (x) => { const g = guardian(x); return [`${x.q.token}: sell = ${n3(g.sell)} ≤ C = ${g.C} ✓`]; },
  },
  {
    id: "G3",
    math: ["HF'(c) = (C−c)·p·L / (D − c·p·(1−s))", "⟹ HF'(sell) = T"],
    live: (x) => { const g = guardian(x); return [`${x.q.token}: HF'(${n3(g.sell)}) = ${n3(g.after(g.sell))} = T ✓`]; },
  },
  {
    id: "G3b",
    math: ["0 ≤ c < sell ⟹ HF'(c) < T"],
    live: (x) => { const g = guardian(x); const c = g.sell * 0.9; return [`${x.q.token}: HF'(0.9·sell) = ${n3(g.after(c))} < ${n2(g.T)} ✓`]; },
  },
  {
    id: "G4",
    math: ["C·p·(1−s) ≤ D ⟹ HF'(c) ≤ HF", "(if selling can't help, it alerts instead)"],
  },
  {
    id: "G5",
    math: ["D ≤ C·p·L ∧ L < 1 − s ⟹ D < C·p·(1−s)"],
    live: ({ quotes }) => [quotes.map((q) => `${q.token} L ${pctL(q.lltv)} < 0.995`).join(" · ")],
  },
  {
    id: "O1",
    math: ["wᵢ ≥ 0, Σ wᵢ = 1, m ≤ xᵢ ≤ M", "⟹ m ≤ Σ wᵢ·xᵢ ≤ M"],
    live: ({ q }) => {
      const xs = q.agents.filter((a) => a.weight > 0).map((a) => a.estimate);
      return [`${q.token}: m = ${$(Math.min(...xs))} ≤ FV = ${$(q.fairValue)} ≤ M = ${$(Math.max(...xs))} ✓`];
    },
  },
  {
    id: "O1a",
    math: ["ŵᵢ = wᵢ / Σ w ⟹ ŵᵢ ≥ 0 ∧ Σ ŵᵢ = 1"],
    live: ({ q }) => [`${q.token}: ŵ = (${q.agents.map((a) => a.weight.toFixed(2)).join(", ")}) · Σ = ${q.agents.reduce((s, a) => s + a.weight, 0).toFixed(2)}`],
  },
  {
    id: "O1b",
    math: ["priorₖ ≥ 0, mseₖ ≥ 0, ε > 0", "⟹ learnedₖ ≥ 0 ∧ Σ learned = Σ prior"],
    live: ({ q }) => [`${q.token}: weights learned from ${q.learned?.sessions ?? 0} graded sessions, all ≥ 0 ✓`],
  },
  {
    id: "O2",
    math: ["conf = clamp(35, 98, 98 − 0.3h − 0.5σ − 10·sim)", "h₁ ≤ h₂ ⟹ conf(h₂) ≤ conf(h₁)"],
    live: ({ quotes }) => [`now: ${quotes.map((q) => `${q.token} ${q.confidence}`).join(" · ")}`],
  },
  {
    id: "O2b",
    math: ["conf = clamp(35, 98, 98 − 0.3h − 0.5σ − 10·sim)", "σ₁ ≤ σ₂ ⟹ conf(σ₂) ≤ conf(σ₁)"],
    live: ({ quotes }) => [`now: ${quotes.map((q) => `${q.token} ${q.confidence}`).join(" · ")}`],
  },
  {
    id: "O3",
    math: ["∀ σ, sim, h:  35 ≤ conf(σ, sim, h) ≤ 98"],
    live: ({ quotes }) => [`now: ${quotes.map((q) => `${q.token} ${q.confidence}`).join(" · ")} ✓ in bounds`],
  },
  { id: "C1", math: ["u < 2⁶⁴, p < 2⁴⁰, L < 2¹⁴", "⟹ u·p·L < 2¹¹⁸ < r_BN254 ≈ 2.19·10⁷⁶"] },
  { id: "C1b", math: ["d < 2⁶⁴ ⟹ d·10⁸ < 2¹²⁰ ≈ 1.33·10³⁶"] },
  { id: "C2", math: ["x < P ⟹ (x mod P) = x", "(no wrap-around inside the circuit's range)"] },
  {
    id: "C4",
    math: ["u ≤ u_true, d_true ≤ d, d·10⁸ < u·p·L", "⟹ d_true·10⁸ < u_true·p·L"],
    live: () => ["Round collateral down, debt up: the proof stays sound ✓"],
  },
];
