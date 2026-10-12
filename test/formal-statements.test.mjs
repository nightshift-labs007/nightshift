// Randomised checks of every theorem statement in formal/Nightshift/*.lean, written in plain JS.
// Not a proof: a fast tripwire that finds counterexamples before Aristotle is asked to prove something false.
// Run: node --test test/formal-statements.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

let seed = 20261012;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const rbig = (bits) => {
  let x = 0n;
  const n = Math.floor(rnd() * bits) + 1;
  for (let i = 0; i < n; i++) x = (x << 1n) | (rnd() < 0.5 ? 1n : 0n);
  return x;
};
const N = 40000;

// ---------------- Vault (exact integer model) ----------------
const W = 10n ** 18n;
const MAX_LIF = 115n * 10n ** 16n;
const value = (c, p) => (c * p) / W;
const hf = (c, p, l, d) => (value(c, p) * l) / d;
const liquidatable = (c, p, l, d) => d > 0n && hf(c, p, l, d) < W;
const healthy = (c, p, l, d) => !liquidatable(c, p, l, d);
const sub = (a, b) => (a > b ? a - b : 0n); // ℕ truncated subtraction
const haircut = (conf) => sub(W, (sub(100n, conf) * W) / 200n);
const borrowLimit = (c, p, l, conf) => (((value(c, p) * l) / W) * haircut(conf)) / W;
const lif = (l) => {
  const v = (W * W) / ((3n * l) / 10n + (7n * W) / 10n);
  return v < MAX_LIF ? v : MAX_LIF;
};
const sample = () => [rbig(90), rbig(80), rbig(61), rbig(100)]; // c, p, l, d

test("Vault V0–V5, V7 hold on random inputs", () => {
  for (let i = 0; i < N; i++) {
    const [c, p, l, d] = sample();
    const h = healthy(c, p, l, d);
    assert.equal(h, d === 0n || W * d <= value(c, p) * l, "V0");
    if (h) {
      assert.ok(W * W * d <= c * p * l, "V5");
      const k = rbig(40);
      assert.ok(healthy(c, p + k, l, d), "V2");
      assert.ok(healthy(c + k, p, l, d), "V3");
      assert.ok(healthy(c, p, l, d > k ? d - k : 0n), "V4");
    }
    const conf = BigInt(Math.floor(rnd() * 140));
    const lim = borrowLimit(c, p, l, conf);
    const dd = lim === 0n ? 0n : lim - (rbig(20) % (lim + 1n));
    assert.ok(healthy(c, p, l, dd), "V7");
  }
});

test("Vault V6: liquidation bonus between 0% and 15% for LLTV ≤ 100%", () => {
  for (const l of [0n, 1n, W / 2n, (77n * W) / 100n, W - 1n, W]) assert.ok(W <= lif(l) && lif(l) <= MAX_LIF, String(l));
  for (let i = 0; i < N; i++) {
    const l = rbig(60) % (W + 1n);
    assert.ok(W <= lif(l) && lif(l) <= MAX_LIF);
  }
});

// ---------------- Guardian (real-number model, floats with tolerance) ----------------
const ghf = (C, p, L, D) => (C * p * L) / D;
const after = (C, p, L, D, s, c) => ((C - c) * p * L) / (D - c * p * (1 - s));
const sell = (C, p, L, D, T, s) => (T * D - L * p * C) / (p * (T * (1 - s) - L));

test("Guardian G1–G3b hold whenever their hypotheses do", () => {
  let tried = 0;
  for (let i = 0; i < N * 5 && tried < N; i++) {
    const p = 1 + rnd() * 2000, D = 1 + rnd() * 1e5, L = 0.05 + rnd() * 0.9, s = rnd() * 0.2, T = 1 + rnd() * 4, C = rnd() * 500;
    if (!(L < T * (1 - s) && ghf(C, p, L, D) < T && D < C * p * (1 - s))) continue;
    tried++;
    const k = sell(C, p, L, D, T, s);
    assert.ok(k >= -1e-9, "G1");
    assert.ok(k <= C * (1 + 1e-12), "G2");
    assert.ok(Math.abs(after(C, p, L, D, s, k) - T) < 1e-6 * T, "G3");
    const c = rnd() * k * 0.999;
    assert.ok(after(C, p, L, D, s, c) < T, "G3b");
  }
  assert.ok(tried > 1000, `only ${tried} cases met the hypotheses`);
});

test("Guardian G4: selling never helps when collateral after slippage can't cover debt", () => {
  for (let i = 0; i < N; i++) {
    const p = 1 + rnd() * 2000, L = 0.05 + rnd() * 0.95, s = rnd() * 0.5, C = rnd() * 100;
    const D = C * p * (1 - s) * (1 + rnd() * 2);
    const c = rnd() * C;
    if (!(D - c * p * (1 - s) > 0)) continue;
    assert.ok(after(C, p, L, D, s, c) <= ghf(C, p, L, D) * (1 + 1e-12));
  }
});

test("Guardian G5: the health ≥ 1 gate implies solvency after slippage when LLTV < 1 − s", () => {
  for (let i = 0; i < N; i++) {
    const s = rnd() * 0.1, L = (1 - s) * rnd() * 0.999 + 1e-6, C = rnd() * 100, p = 1 + rnd() * 1000;
    const D = C * p * L * rnd() + 1e-9;
    if (!(D <= C * p * L)) continue;
    assert.ok(D < C * p * (1 - s));
  }
});

// ---------------- Oracle ----------------
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));
const confidence = (disp, sim, h) => clamp(35, 98, 98 - 0.3 * h - 0.5 * disp - 10 * sim);

test("Oracle O1/O1a: normalised blend stays within the signals", () => {
  for (let i = 0; i < N; i++) {
    const n = 1 + Math.floor(rnd() * 5);
    const w = Array.from({ length: n }, () => rnd());
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) continue;
    const nw = w.map((x) => x / sum);
    assert.ok(Math.abs(nw.reduce((a, b) => a + b, 0) - 1) < 1e-12 && nw.every((x) => x >= 0), "O1a");
    const x = Array.from({ length: n }, () => 100 + rnd() * 900);
    const f = nw.reduce((a, wi, j) => a + wi * x[j], 0);
    assert.ok(f >= Math.min(...x) - 1e-9 && f <= Math.max(...x) + 1e-9, "O1");
  }
});

test("Oracle O1b: learned weights stay non-negative and keep the prior mass", () => {
  for (let i = 0; i < N; i++) {
    const prior = [rnd(), rnd(), rnd()], mse = [rnd() * 1e-3, rnd() * 1e-3, rnd() * 1e-3], eps = 1e-8;
    const inv = mse.map((m) => 1 / (m + eps));
    const isum = inv.reduce((a, b) => a + b, 0);
    const psum = prior.reduce((a, b) => a + b, 0);
    const w = prior.map((pk, k) => 0.5 * pk + 0.5 * psum * (inv[k] / isum));
    assert.ok(w.every((x) => x >= 0));
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - psum) < 1e-9);
  }
});

test("Oracle O2/O2b/O3: confidence is monotone in time and dispersion, and bounded", () => {
  for (let i = 0; i < N; i++) {
    const d = rnd() * 200, sim = rnd() < 0.5 ? 0 : 1, h1 = rnd() * 300, h2 = h1 + rnd() * 100;
    assert.ok(confidence(d, sim, h2) <= confidence(d, sim, h1), "O2");
    assert.ok(confidence(d + rnd() * 50, sim, h1) <= confidence(d, sim, h1), "O2b");
    const c = confidence(d, sim, h1);
    assert.ok(c >= 35 && c <= 98, "O3");
  }
});

// ---------------- Cloak ----------------
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
test("Cloak C1a/C1b: the circuit's worst-case products fit their bounds", () => {
  const maxCap = (2n ** 64n - 1n) * (2n ** 40n - 1n) * (2n ** 14n - 1n);
  assert.ok(maxCap < 2n ** 118n && 2n ** 118n < R, "C1a");
  assert.ok((2n ** 64n - 1n) * 10n ** 8n < 2n ** 120n, "C1b");
});
test("Cloak C4: rounding collateral down and debt up never lets an insolvent loan pass", () => {
  for (let i = 0; i < N; i++) {
    const uT = rbig(60), dT = rbig(60), p = rbig(39), l = rbig(13);
    const u = uT - (uT > 0n ? rbig(10) % (uT + 1n) : 0n), d = dT + rbig(10);
    if (d * 10n ** 8n < u * p * l) assert.ok(dT * 10n ** 8n < uT * p * l);
  }
});
