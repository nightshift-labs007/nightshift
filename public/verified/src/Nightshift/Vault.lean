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
  unfold healthy liquidatable hf
  rcases Nat.eq_zero_or_pos d with rfl | hd
  · simp
  · rw [Nat.div_lt_iff_lt_mul hd]
    constructor
    · intro h; right; by_contra h'; exact h ⟨hd, by push_neg at h'; linarith [mul_comm WAD d]⟩
    · rintro (h | h)
      · omega
      · rintro ⟨-, h2⟩; nlinarith [mul_comm WAD d]

-- V1: a healthy position can never be liquidated
theorem healthy_not_liquidatable {c p l d : ℕ}
    (h : healthy c p l d) : ¬ liquidatable c p l d := by
  exact h

-- V2: a price increase never makes a healthy loan unhealthy
theorem healthy_mono_price {c p₁ p₂ l d : ℕ} (hp : p₁ ≤ p₂)
    (h : healthy c p₁ l d) : healthy c p₂ l d := by
  rw [healthy_iff] at *
  rcases h with h | h
  · exact Or.inl h
  · right
    have : value c p₁ ≤ value c p₂ := Nat.div_le_div_right (Nat.mul_le_mul_left _ hp)
    exact h.trans (Nat.mul_le_mul_right _ this)

-- V3: adding collateral never makes a healthy loan unhealthy
theorem healthy_mono_collateral {c₁ c₂ p l d : ℕ} (hc : c₁ ≤ c₂)
    (h : healthy c₁ p l d) : healthy c₂ p l d := by
  rw [healthy_iff] at *
  rcases h with h | h
  · exact Or.inl h
  · right
    have : value c₁ p ≤ value c₂ p := Nat.div_le_div_right (Nat.mul_le_mul_right _ hc)
    exact h.trans (Nat.mul_le_mul_right _ this)

-- V4: repaying debt never makes a healthy loan unhealthy
theorem healthy_anti_debt {c p l d₁ d₂ : ℕ} (hd : d₁ ≤ d₂)
    (h : healthy c p l d₂) : healthy c p l d₁ := by
  rw [healthy_iff] at *
  rcases h with h | h
  · left; omega
  · right; exact (Nat.mul_le_mul_left _ hd).trans h

-- V5: rounding is conservative: a loan the integer check calls healthy is healthy in exact arithmetic
theorem healthy_conservative {c p l d : ℕ}
    (h : healthy c p l d) : WAD * WAD * d ≤ c * p * l := by
  rw [healthy_iff] at h
  rcases h with rfl | h
  · simp
  · have h1 : WAD * (c * p / WAD) ≤ c * p := Nat.mul_div_le _ _
    unfold value at h
    calc WAD * WAD * d = WAD * (WAD * d) := by ring
      _ ≤ WAD * (c * p / WAD * l) := Nat.mul_le_mul_left _ h
      _ = (WAD * (c * p / WAD)) * l := by ring
      _ ≤ c * p * l := Nat.mul_le_mul_right _ h1

-- V6: liquidators are paid a bonus of at least 0% and at most 15%
theorem lif_bounds (l : ℕ) (hl : l ≤ WAD) :
    WAD ≤ lif l ∧ lif l ≤ MAX_LIF := by
  unfold lif
  refine ⟨le_min (by unfold WAD MAX_LIF; norm_num) ?_, min_le_left _ _⟩
  have hpos : 0 < 3 * l / 10 + 7 * WAD / 10 := by unfold WAD; norm_num
  rw [Nat.le_div_iff_mul_le hpos]
  have : 3 * l / 10 + 7 * WAD / 10 ≤ WAD := by
    have : 3 * l / 10 ≤ 3 * WAD / 10 := Nat.div_le_div_right (by omega)
    unfold WAD at *; omega
  exact Nat.mul_le_mul_left _ this

-- V7: any debt within the Nightshift borrow limit is healthy at that same price
theorem borrowLimit_healthy {c p l conf d : ℕ}
    (hd : d ≤ borrowLimit c p l conf) : healthy c p l d := by
  rw [healthy_iff]
  right
  have hh : haircut conf ≤ WAD := Nat.sub_le _ _
  have hWAD : 0 < WAD := by unfold WAD; norm_num
  unfold borrowLimit at hd
  have h1 : d * WAD ≤ value c p * l / WAD * haircut conf :=
    (Nat.le_div_iff_mul_le hWAD).1 hd
  have h2 : value c p * l / WAD * WAD ≤ value c p * l := Nat.div_mul_le_self _ _
  have h3 := Nat.mul_le_mul_left (value c p * l / WAD) hh
  rw [mul_comm]; omega

end Nightshift.Vault
