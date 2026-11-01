import { MAX_LEG_WEIGHT } from "./schemas/basket";

/** Rescales to sum exactly 1 at 6 decimals, then caps at MAX_LEG_WEIGHT, redistributing the excess. */
export function normalizeWeights<T extends { weight: number }>(legs: T[]): T[] {
  let w = legs.map((l) => l.weight);
  for (let i = 0; i < 10; i++) {
    const sum = w.reduce((a, b) => a + b, 0);
    w = w.map((x) => x / sum);
    const over = w.reduce((s, x) => s + Math.max(0, x - MAX_LEG_WEIGHT), 0);
    if (over < 1e-12) break;
    const room = w.reduce((s, x) => s + (x < MAX_LEG_WEIGHT ? MAX_LEG_WEIGHT - x : 0), 0);
    w = w.map((x) => (x >= MAX_LEG_WEIGHT ? MAX_LEG_WEIGHT : x + (over * (MAX_LEG_WEIGHT - x)) / room));
  }
  const rounded = w.map((x) => Math.round(x * 1e6) / 1e6);
  const residual = Math.round((1 - rounded.reduce((a, b) => a + b, 0)) * 1e6) / 1e6;
  const target = rounded.findIndex((x) => x + residual <= MAX_LEG_WEIGHT && x + residual > 0);
  if (target >= 0) rounded[target] = Math.round((rounded[target]! + residual) * 1e6) / 1e6;
  return legs.map((l, i) => ({ ...l, weight: rounded[i]! }));
}
