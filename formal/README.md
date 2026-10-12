# Nightshift formal verification

Lean 4 models of Nightshift's safety-critical math, proved by Harmonic's Aristotle and re-checked by
Lean's kernel. Pinned to Lean `v4.34.1` and Mathlib `v4.34.1`.

| File | Models |
|---|---|
| `Nightshift/Vault.lean` | `NightshiftVault.sol`: health, liquidation, borrow limit, liquidation incentive (V0–V7) |
| `Nightshift/Guardian.lean` | the Guardian's sale rule in the contract, keeper and paper engine (G1–G5) |
| `Nightshift/Oracle.lean` | fair-value blend, weight invariants, confidence (O1–O3) |
| `Nightshift/Cloak.lean` | the Groth16 circuit's bit budget and rounding soundness (C1–C4) |
| `Vectors.lean` | emits test vectors the real contract must reproduce exactly |
| `properties.json` | the published properties (source for the audit, manifest and website) |
| `MAPPING.md` | code ↔ Lean mapping, findings and decisions |
| `PROPERTIES.md` | generated status table |

## Workflow

```sh
# one-time: install elan (Lean version manager), then
cd formal && lake exe cache get && cd ..

# 1. prove: put ARISTOTLE_API_KEY in .env.local (never commit it), then one module at a time
pip install aristotlelib
npm run formal:prove -- Guardian        # then Vault, Oracle, Cloak (or: all)

# 2. check: build, axiom audit (no sorryAx), Lean vectors, manifest
npm run formal:check

# 3. link to the real code: local chain + vector replay + G4 regression tests
npm run chain:local                     # in another terminal
npm run formal:test

# 4. anchor the manifest hash on Algorand TestNet (needs ALGORAND_MNEMONIC with test ALGO)
npm run formal:anchor
```

`formal:prove` accepts Aristotle's result only if every definition and theorem statement comes back
unchanged; otherwise it saves Aristotle's file as `aristotle-<Module>.rejected.lean` for review. If
Aristotle reports a statement is false, treat it as a possible protocol bug: do not weaken the theorem.

A property is shown as **verified** on nightshift.buzz only when `#print axioms` for its theorem lists
nothing beyond `propext`, `Classical.choice` and `Quot.sound`.

## Scope

Proofs cover Lean models of the logic. The link to deployed code is through test vectors and regression
tests, not a compiler-level proof. Real-number models (Guardian, Oracle) ignore rounding; known integer
gaps are listed in `MAPPING.md`. The full ZK circuit, Morpho itself and the off-chain models are out of
scope for v1. Formal verification does not replace a professional security audit.
