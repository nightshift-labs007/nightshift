import { priceAt, toSessions, type PairData } from "./data";
import type { loadGlobals } from "./data";

/**
 * Learns the market-signal weights from the track record: each signal (anchor, global, momentum)
 * is replayed at every recent open using only data available before it, and weighted by the
 * inverse of its mean squared error, blended 50/50 with the prior so one noisy week can't swing it.
 * Sentiment and news keep fixed weights (no reliable history to fit them on).
 */

export type Learned = { anchor: number; global: number; momentum: number; sessions: number; mse: Record<string, number> };

const PRIOR = { anchor: 0.6, global: 0.2, momentum: 0.1 };
const PRIOR_SUM = PRIOR.anchor + PRIOR.global + PRIOR.momentum;

export function learnWeights(d: PairData, globals: Awaited<ReturnType<typeof loadGlobals>>, globalSens: number, beta: number): Learned {
  const nowS = Date.now() / 1000;
  const sessions = toSessions(d.etf.bars).filter((s) => s.openT <= nowS);
  const err = { anchor: [] as number[], global: [] as number[], momentum: [] as number[] };
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    const s = sessions[i];
    const aClose = priceAt(d.anchor.bars, prev.closeT);
    const aOpen = priceAt(d.anchor.bars, s.openT);
    const a3h = priceAt(d.anchor.bars, s.openT - 3 * 3600);
    if (!aClose || !aOpen || !a3h) continue;
    const anchorEst = prev.close * (1 + beta * (aOpen / aClose - 1));
    const gMoves = globals
      .map((g) => {
        const then = priceAt(g.chart.bars, prev.closeT);
        const at = priceAt(g.chart.bars, s.openT);
        return then && at ? at / then - 1 : NaN;
      })
      .filter(Number.isFinite);
    const gMove = gMoves.length ? gMoves.reduce((x, y) => x + y, 0) / gMoves.length : 0;
    const globalEst = prev.close * (1 + globalSens * gMove);
    const momentumEst = anchorEst * (1 + 0.25 * (aOpen / a3h - 1));
    const rel = (est: number) => (est / s.open - 1) ** 2;
    err.anchor.push(rel(anchorEst));
    err.global.push(rel(globalEst));
    err.momentum.push(rel(momentumEst));
  }
  const n = err.anchor.length;
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
  const mse = { anchor: mean(err.anchor), global: mean(err.global), momentum: mean(err.momentum) };
  if (n < 5 || d.source !== "live") return { ...PRIOR, sessions: n, mse };

  const inv = { anchor: 1 / (mse.anchor + 1e-8), global: 1 / (mse.global + 1e-8), momentum: 1 / (mse.momentum + 1e-8) };
  const invSum = inv.anchor + inv.global + inv.momentum;
  const blend = (k: keyof typeof PRIOR) => 0.5 * PRIOR[k] + 0.5 * PRIOR_SUM * (inv[k] / invSum);
  return { anchor: blend("anchor"), global: blend("global"), momentum: blend("momentum"), sessions: n, mse };
}
