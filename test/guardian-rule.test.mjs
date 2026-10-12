// Regression tests for the Guardian rule (formal/Nightshift/Guardian.lean). Run: node --test test/
import assert from "node:assert/strict";
import test from "node:test";
import { SLIPPAGE, sellAmount, sellingCanHelp } from "../lib/guardian-rule.ts";

const hfAfter = (C, p, L, D, c) => ((C - c) * p * L) / (D - c * p * (1 - SLIPPAGE));

test("G3: the sale lands exactly on the target", () => {
  const [C, p, L, D, T] = [5, 700, 0.77, 2700, 1.4];
  const k = sellAmount(C, p, D, L, T);
  assert.ok(Math.abs(hfAfter(C, p, L, D, k) - T) < 1e-9);
});

test("G2: never sells more collateral than exists", () => {
  for (const D of [100, 1000, 2690, 3000]) assert.ok(sellAmount(5, 700, D, 0.77, 1.4) <= 5);
});

test("G4: alert-only when collateral after slippage can't cover the debt", () => {
  const [C, p, D] = [5, 600, 3000]; // 5 × 600 × 0.995 = 2985 ≤ 3000
  assert.equal(sellingCanHelp(C, p, D), false);
  for (const c of [0.1, 1, 2.5]) assert.ok(hfAfter(C, p, 0.77, D, c) <= (C * p * 0.77) / D, "a sale would lower health");
});

test("G4: selling allowed when it can help", () => {
  assert.equal(sellingCanHelp(5, 700, 2700), true);
});
