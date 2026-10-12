// The Guardian's sale rule, shared by the paper engine and its regression test.
// Proven in formal/Nightshift/Guardian.lean (G1–G5); keep this file free of imports so Node can run it directly.

export const SLIPPAGE = 0.005;

/** G4: a sale can only raise health when the collateral, sold at the slippage price, is worth more than the debt.
 *  Otherwise every sale makes health worse, so the Guardian must alert instead of selling. */
export function sellingCanHelp(units: number, price: number, debt: number, slippage = SLIPPAGE): boolean {
  return units * price * (1 - slippage) > debt;
}

/** Minimal sale that lands exactly on target health T: k = (T·D − L·P·C) / (P·(T·(1 − s) − L)), clipped to [0, C]. */
export function sellAmount(units: number, price: number, debt: number, lltv: number, target: number, slippage = SLIPPAGE): number {
  const k = (target * debt - lltv * price * units) / (price * (target * (1 - slippage) - lltv));
  return Math.max(0, Math.min(units, k));
}
