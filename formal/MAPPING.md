# Code ↔ Lean mapping

Discovery for the formal-verification spec (Section 3). Each row quotes the implemented expression, its
types, scaling and rounding, and the Lean definition that models it. Where the code differs from the
spec's assumed model, the Lean model follows the **code**, and the difference is listed under "Findings".

## Vault: `contracts/NightshiftVault.sol` → `Nightshift/Vault.lean`

| Code | Exact implementation | Lean |
|---|---|---|
| `WAD` | `uint256 constant WAD = 1e18` | `WAD := 10 ^ 18` |
| Oracle price scale | `NightshiftOracle` stores WAD prices (18 decimals). The 1e36 scale exists only in `MorphoOracleAdapter.price() = p × 1e18` for Morpho compatibility | prices are WAD |
| `collateralValue` | `(collateral * price) / WAD`: floor | `value c p := c * p / WAD` |
| `healthFactor` | `(collateralValue * lltv) / debt`: floor; `type(uint256).max` when `debt == 0` | `hf c p l d := value c p * l / d` |
| liquidation condition | `liquidate` requires `healthFactor < WAD` | `liquidatable := 0 < d ∧ hf < WAD` |
| `borrowLimit` | `(((value * lltv) / WAD) * haircut) / WAD`, `haircut = WAD - ((100 - confidence) * WAD) / 200`: all floor; `confidence ≤ 100` enforced by `NightshiftOracle.setPrices` | `borrowLimit`, `haircut` |
| `borrow` | requires `debt ≤ borrowLimit` after adding | V7 `borrowLimit_healthy` |
| `withdraw` | requires `healthFactor ≥ 1.1e18` if debt remains | (covered by V2–V4 monotonicity) |
| `lif` | `(WAD * WAD) / ((3 * lltv) / 10 + (7 * WAD) / 10)`, capped at `1.15e18`: floor | `lif` |
| `setMarket` | `0 < lltv < WAD` | hypothesis `l ≤ WAD` in V6 |
| shares ↔ assets | **none**: positions store raw collateral and debt; no share accounting, no interest | the spec's share-rounding theorems don't apply |

Overflow: Solidity 0.8 checked arithmetic reverts on overflow, so the ℕ model (no overflow) can only be
more permissive than the contract, never produce a different successful result.

## Guardian: `NightshiftVault.protect`, `lib/chain/keeper.ts`, `lib/paper.ts` → `Nightshift/Guardian.lean`

| Code | Exact implementation | Lean |
|---|---|---|
| trigger | contract: `require(hfBefore < r.trigger)` and `require(hfBefore >= WAD)`; keeper skips `hf >= trigger \|\| hf < WAD`; paper: liquidation branch first when `hf < 1` | hypotheses `hbelow`, G5 |
| rule levels | `setRule`: `trigger > WAD`, `target ≥ trigger + 0.05e18`, `target ≤ 5e18` | `hT` |
| slippage | `SLIPPAGE_WAD = 0.005e18`, sale price `price * (WAD - SLIPPAGE_WAD) / WAD` | `s` |
| sale size | closed form, no search loop: `k = ((T·D − P·u·L) · WAD) / (P · (T(1−s) − L) / WAD)`, **floor**; then `k ≤ collateral`; `repaid = k · sellPrice / WAD` (floor), capped at debt | `sellAmount` |
| alert vs act | mode 1 = alert (UI only), mode 2 = auto-protect | — |
| G4 alert-only | **added** in this change: contract `require(collateral·sellPrice/WAD > debt, "insolvent: alert only")`; keeper checks the same before calling `protect`; paper Guardian falls back to an alert via `sellingCanHelp` in `lib/guardian-rule.ts` | G4 `no_sell_when_insolvent` |

## Oracle: `lib/oracle.ts`, `lib/weights.ts` → `Nightshift/Oracle.lean`

| Code | Exact implementation | Lean |
|---|---|---|
| blend | `fair = Σ weight_i × estimate_i` after `weight_i /= Σ weight` (normalised) | `blend`, `normalize` |
| weights | priors anchor .6 / global .2 / momentum .1 / sentiment .1 (0 if feed offline) / news .1 (only if enabled) | O1a |
| learned weights | `0.5·prior_k + 0.5·0.9·inv_k/Σinv`, `inv_k = 1/(mse_k + 1e-8)`, only with ≥ 5 live sessions | `learned`, O1b |
| confidence | `round(clamp(98 − 0.3·hours − 0.5·dispersionBps − (simulated ? 10 : 0), 35, 98))`: **linear**, not exponential | `confidence`, O2, O2b, O3 |
| band/clamp on fair value | **none** | spec's O4 not applicable |
| market open | fair value = ETF price, confidence 99 (outside the closed-market model) | — |

## Cloak: `zk/solvency.circom`, `components/Cloak.tsx`, `app/api/zk/verify/route.ts` → `Nightshift/Cloak.lean`

| Code | Exact implementation | Lean |
|---|---|---|
| field | Groth16 over BN254 (snarkjs), r ≈ 2^253.6 | `BN254_R` |
| inputs | public `priceCents`, `lltvBps`; private `units` (1e-4 token), `debtCents`, `salt` | — |
| range checks | `Num2Bits(64)` units, `Num2Bits(64)` debtCents, `Num2Bits(40)` priceCents, `Num2Bits(14)` lltvBps | C1a, C1b |
| constraint | `units·priceCents·lltvBps > debtCents·10^8` via `GreaterThan(120)` | `circuitSolvent` |
| bit budget | capacity ≤ 64+40+14 = **118 bits**; need < 2^64·10^8 < **2^91**; both < 2^120 (GreaterThan precondition) and far below 2^253: **no refactor needed** | C1a, C1b |
| client rounding | units `floor(units·1e4)`; debt **was `Math.round`**, now `ceil(debt·100)` | C4 |
| server checks | proof valid ∧ `|priceCents/oracle − 1| ≤ 0.5%` ∧ `lltvBps = round(lltv·1e4)` | — |

## Ledger: `lib/algorand.ts` → manifest anchoring

Algorand TestNet via AlgoNode; 0-ALGO self-payment; note `nightshift:v1:` + prediction JSON + SHA-256.
Verification manifests use the separate prefix `nightshift:verified:v1:<sha256>:<commit>` so the existing
`/api/ledger` reader (which filters `nightshift:v1:`) ignores them.

## Findings (decisions recorded)

1. **Spec model vs code, Vault scale.** The spec assumes Morpho's `mulDivDown(price, 1e36).wMulDown(lltv)`.
   The contract uses WAD prices and computes the health factor as a division by debt. Modelled as coded;
   V5 is stated against the exact product `c·p·l ≥ 1e36·d`. *Decision: keep code, model updated.*
2. **G4 was only implicit.** `protect` refused HF < 1, which implies solvency after slippage only while
   LLTV < 1 − 0.5% (G5). `setMarket` accepts any LLTV < 100%, so a market above 99.5% could sell into a
   worsening position. *Decision: enforce G4 explicitly in the contract, keeper and paper Guardian; regression
   tests in `scripts/test-formal.mjs` and `test/guardian-rule.test.mjs`.*
3. **Guardian integer rounding (gap G-INT).** The contract floors `k`, so on-chain the result can land a few
   wei of health below the target (the real-number G3 is exact). *Decision: documented gap; acceptable for the
   testnet demo; next step is to round `k` up and prove "lands at or above target" for the integer model.*
4. **Confidence is not monotone in time alone.** It also depends on signal dispersion, which can fall, so the
   spec's "confidence never rises while the market stays closed" is false for the real system. *Decision:
   publish the true statements: O2 (holding agreement fixed), O2b (more disagreement never raises it), O3 (bounds).*
5. **Cloak debt rounding.** The client rounded debt to the nearest cent, so a position insolvent by under half a
   cent could prove solvency. *Decision: round debt up and collateral down (C4); fixed in `components/Cloak.tsx`.*
6. **Circuit bit budget is fine** (118 bits vs ~253.6): the spec's suspected overflow does not occur, because the
   circuit uses cents and basis points, not Morpho's 1e36/1e18 scales.
