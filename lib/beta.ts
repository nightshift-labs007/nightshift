import { priceAt, type Bar, type Session } from "./data";

/**
 * Measured overnight beta of an ETF to its anchor: how far the ETF opened (vs its previous close) per unit of the
 * anchor's move over the same night (previous close → this open). Ordinary least squares over the sessions given,
 * then the Blume adjustment (0.67·β + 0.33) to pull a short-window estimate toward 1, clamped to 0.5–1.5. With fewer
 * than MIN_SESSIONS nights, or a fit with R² below MIN_R2, it falls back to 1.0 and says so.
 */
export type BetaEstimate = { value: number; raw: number | null; r2: number | null; sessions: number; fallback: null | "few sessions" | "low R²" };

const MIN_SESSIONS = 10;
const MIN_R2 = 0.3;

export function overnightBeta(sessions: Session[], anchorBars: Bar[]): BetaEstimate {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    const s = sessions[i];
    const aClose = priceAt(anchorBars, prev.closeT);
    const aOpen = priceAt(anchorBars, s.openT);
    if (!aClose || !aOpen || !(prev.close > 0) || !(s.open > 0)) continue;
    xs.push(aOpen / aClose - 1);
    ys.push(s.open / prev.close - 1);
  }
  const n = xs.length;
  if (n < MIN_SESSIONS) return { value: 1, raw: null, r2: null, sessions: n, fallback: "few sessions" };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { value: 1, raw: null, r2: null, sessions: n, fallback: "few sessions" };
  const raw = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  if (r2 < MIN_R2) return { value: 1, raw, r2, sessions: n, fallback: "low R²" };
  return { value: Math.max(0.5, Math.min(1.5, 0.67 * raw + 0.33)), raw, r2, sessions: n, fallback: null };
}
