import Mathlib

/-!
# Vault (models `contracts/NightshiftVault.sol`)

The contract works in `uint256` WAD fixed point (`WAD = 1e18`); prices from `NightshiftOracle` are
also WAD (not Morpho's 1e36: the 1e36 scale exists only in `MorphoOracleAdapter.price()`).
We model over `ℕ`, which never overflows; Solidity 0.8's checked arithmetic reverts instead of
wrapping, so overflow cannot produce a wrong answer, only a failed transaction.
Every `/` below is floor division, exactly like Solidity's integer `/`.
See `formal/MAPPING.md` for the line-by-line correspondence.
-/

namespace Nightshift.Vault

/-- `WAD = 1e18` -/
def WAD : ℕ := 10 ^ 18

/-- `lif` caps the incentive at `1.15e18`. -/
def MAX_LIF : ℕ := 115 * 10 ^ 16

/-- `collateralValue`: `(collateral * price) / WAD`. -/
def value (collateral price : ℕ) : ℕ := collateral * price / WAD

/-- `healthFactor` for a position with debt: `(collateralValue * lltv) / debt`, in WAD. -/
def hf (collateral price lltv debt : ℕ) : ℕ := value collateral price * lltv / debt

/-- `liquidate` requires `healthFactor < WAD`; with zero debt `healthFactor` returns
`type(uint256).max`, so a debt-free position is never liquidatable. -/
def liquidatable (c p l d : ℕ) : Prop := 0 < d ∧ hf c p l d < WAD

def healthy (c p l d : ℕ) : Prop := ¬ liquidatable c p l d

/-- `borrowLimit` haircut: `WAD - ((100 - confidence) * WAD) / 200`. -/
def haircut (conf : ℕ) : ℕ := WAD - (100 - conf) * WAD / 200

/-- `borrowLimit`: `(((value * lltv) / WAD) * haircut) / WAD`. -/
def borrowLimit (c p l conf : ℕ) : ℕ := value c p * l / WAD * haircut conf / WAD

/-- `lif`: `v = (WAD * WAD) / ((3 * lltv) / 10 + (7 * WAD) / 10)`, then `v > 1.15e18 ? 1.15e18 : v`. -/
def lif (lltv : ℕ) : ℕ := min MAX_LIF (WAD * WAD / (3 * lltv / 10 + 7 * WAD / 10))

-- V0: the integer health check means exactly "debt × 1e18 ≤ collateral value × LLTV"
theorem healthy_iff {c p l d : ℕ} :
    healthy c p l d ↔ d = 0 ∨ WAD * d ≤ value c p * l := by
  sorry

-- V1: a healthy position can never be liquidated
theorem healthy_not_liquidatable {c p l d : ℕ}
    (h : healthy c p l d) : ¬ liquidatable c p l d := by
  sorry

-- V2: a price increase never makes a healthy loan unhealthy
theorem healthy_mono_price {c p₁ p₂ l d : ℕ} (hp : p₁ ≤ p₂)
    (h : healthy c p₁ l d) : healthy c p₂ l d := by
  sorry

-- V3: adding collateral never makes a healthy loan unhealthy
theorem healthy_mono_collateral {c₁ c₂ p l d : ℕ} (hc : c₁ ≤ c₂)
    (h : healthy c₁ p l d) : healthy c₂ p l d := by
  sorry

-- V4: repaying debt never makes a healthy loan unhealthy
theorem healthy_anti_debt {c p l d₁ d₂ : ℕ} (hd : d₁ ≤ d₂)
    (h : healthy c p l d₂) : healthy c p l d₁ := by
  sorry

-- V5: rounding is conservative: a loan the integer check calls healthy is healthy in exact arithmetic
theorem healthy_conservative {c p l d : ℕ}
    (h : healthy c p l d) : WAD * WAD * d ≤ c * p * l := by
  sorry

-- V6: liquidators are paid a bonus of at least 0% and at most 15%
theorem lif_bounds (l : ℕ) (hl : l ≤ WAD) :
    WAD ≤ lif l ∧ lif l ≤ MAX_LIF := by
  sorry

-- V7: any debt within the Nightshift borrow limit is healthy at that same price
theorem borrowLimit_healthy {c p l conf d : ℕ}
    (hd : d ≤ borrowLimit c p l conf) : healthy c p l d := by
  sorry

end Nightshift.Vault
