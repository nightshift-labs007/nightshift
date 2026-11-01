import Big from "big.js";

Big.DP = 18;
Big.RM = Big.roundHalfUp;

// FV = last_close × (1 + β × Δproxy) · gap_bps = (token_mid − FV) / FV × 10,000

/** Return of a (possibly blended, "CL+ES") proxy since the close: equal-weight average of its parts. */
export function proxyReturn(parts: { now: string; close: string }[]): string {
  if (parts.length === 0) throw new Error("proxyReturn: no parts");
  const sum = parts.reduce((s, p) => s.plus(new Big(p.now).div(p.close).minus(1)), new Big(0));
  return sum.div(parts.length).toFixed(18);
}

export function fairValue(lastClose: string, beta: string, dProxy: string): string {
  return new Big(lastClose).times(new Big(1).plus(new Big(beta).times(dProxy))).toFixed(18);
}

export function gapBps(mid: string, fv: string): number {
  return Math.round(Number(new Big(mid).minus(fv).div(fv).times(10_000).toFixed(4)));
}

/** Move since the close in bps; used to skip legs that already moved past a typical reaction. */
export function moveBps(mid: string, close: string): number {
  return Math.round(Number(new Big(mid).div(close).minus(1).times(10_000).toFixed(4)));
}

/** OLS slope through the origin is wrong for gap returns with drift, so fit with an intercept. */
export function fitBeta(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 20) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i]! - mx) * (ys[i]! - my);
    varx += (xs[i]! - mx) ** 2;
  }
  return varx === 0 ? null : cov / varx;
}

/** Price per token from a quote: USDG in / tokens out, both as decimal strings. */
export function unitPrice(usdgIn: string, tokensOut: string): string {
  return new Big(usdgIn).div(tokensOut).toFixed(18);
}

/** Slippage of a sized quote vs a small reference quote, in bps (never negative). */
export function slippageBps(sizedPrice: string, smallPrice: string): number {
  const bps = Number(new Big(sizedPrice).div(smallPrice).minus(1).times(10_000).toFixed(4));
  return Math.max(0, Math.ceil(bps - 1e-9));
}
