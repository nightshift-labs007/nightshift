import Mathlib

/-!
# Guardian (models `NightshiftVault.protect`, `lib/chain/keeper.ts` and `guardianTick` in `lib/paper.ts`)

All three implementations size the sale with the same closed form (no search loop):
`k = (T·D − P·u·L) / (P·(T·(1 − s) − L))`, slippage `s = 0.5%`, sale price `P·(1 − s)`.
This file is the real-number model. The contract's integer version rounds `k` down
(see `formal/MAPPING.md`, gap G-INT), so on-chain it can land a hair below the target.
-/

namespace Nightshift.Guardian

noncomputable def hf (C p L D : ℝ) : ℝ := C * p * L / D

noncomputable def hfAfter (C p L D s c : ℝ) : ℝ :=
  (C - c) * p * L / (D - c * p * (1 - s))

noncomputable def sellAmount (C p L D T s : ℝ) : ℝ :=
  (T * D - L * p * C) / (p * (T * (1 - s) - L))

section
variable {C p L D T s : ℝ}
  (hp : 0 < p) (hD : 0 < D) (hL : 0 < L)
  (hs0 : 0 ≤ s) (hs1 : s < 1) (hT : L < T * (1 - s))
  (hbelow : hf C p L D < T)        -- Guardian triggered
  (hsolv : D < C * p * (1 - s))    -- position is economically solvent after slippage

include hp hD hL hs0 hs1 hT hbelow hsolv

-- G1: the computed sale is non-negative
theorem sellAmount_nonneg : 0 ≤ sellAmount C p L D T s := by
  unfold sellAmount
  unfold hf at hbelow
  rw [div_lt_iff₀ hD] at hbelow
  apply div_nonneg <;> nlinarith

-- G2: the Guardian never sells more collateral than exists
theorem sellAmount_le_collateral : sellAmount C p L D T s ≤ C := by
  unfold sellAmount
  have hden : 0 < p * (T * (1 - s) - L) := mul_pos hp (by linarith)
  rw [div_le_iff₀ hden]
  have hT0 : 0 < T := by nlinarith
  nlinarith [mul_lt_mul_of_pos_left hsolv hT0]

-- G3: the sale restores health exactly to the target
theorem sellAmount_reaches_target :
    hfAfter C p L D s (sellAmount C p L D T s) = T := by
  unfold hfAfter sellAmount
  have hA : 0 < T * (1 - s) - L := by linarith
  have hden : p * (T * (1 - s) - L) ≠ 0 := (mul_pos hp hA).ne'
  have hT0 : 0 < T := by nlinarith
  have key : D - (T * D - L * p * C) / (p * (T * (1 - s) - L)) * p * (1 - s)
      = L * (C * p * (1 - s) - D) / (T * (1 - s) - L) := by
    field_simp; ring
  have key2 : (C - (T * D - L * p * C) / (p * (T * (1 - s) - L))) * p * L
      = T * L * (C * p * (1 - s) - D) / (T * (1 - s) - L) := by
    field_simp; ring
  rw [key, key2]
  have hX : C * p * (1 - s) - D ≠ 0 := (sub_pos.2 hsolv).ne'
  field_simp

-- G3b: minimality: any smaller sale stays below target (never oversells)
theorem sellAmount_minimal {c : ℝ} (hc0 : 0 ≤ c)
    (hc : c < sellAmount C p L D T s) : hfAfter C p L D s c < T := by
  unfold hfAfter
  unfold sellAmount at hc
  have hA : 0 < T * (1 - s) - L := by linarith
  have hden : 0 < p * (T * (1 - s) - L) := mul_pos hp hA
  rw [lt_div_iff₀ hden] at hc
  have h1s : 0 < 1 - s := by linarith
  have hT0 : 0 < T := by nlinarith
  have hpos : 0 < D - c * p * (1 - s) := by
    have hprod : 0 < (D - c * p * (1 - s)) * (T * (1 - s) - L) := by
      nlinarith [mul_lt_mul_of_pos_left hc h1s, mul_pos hL (sub_pos.2 hsolv)]
    exact pos_of_mul_pos_left hprod hA.le
  rw [div_lt_iff₀ hpos]
  nlinarith
end

-- G4: if collateral after slippage cannot cover the debt, selling never helps
theorem no_sell_when_insolvent {C p L D s c : ℝ}
    (hp : 0 < p) (hL : 0 < L) (hs1 : s < 1) (hc0 : 0 ≤ c) (hcC : c ≤ C)
    (hins : C * p * (1 - s) ≤ D) (hden : 0 < D - c * p * (1 - s)) :
    hfAfter C p L D s c ≤ hf C p L D := by
  unfold hfAfter hf
  have h1s : 0 < 1 - s := by linarith
  have hcp : 0 ≤ c * p * (1 - s) := by positivity
  have hD : 0 < D := by linarith
  rw [div_le_div_iff₀ hden hD]
  have : 0 ≤ p * L * c * (D - C * p * (1 - s)) := by
    apply mul_nonneg (by positivity); linarith
  nlinarith

-- G5: the on-chain gate (protect only runs while health ≥ 1) already implies the solvency
-- condition of G1–G3 whenever the market's LLTV is below 1 − slippage (0.77 < 0.995)
theorem healthy_gate_solvent {C p L D s : ℝ}
    (hD : 0 < D) (hL : 0 < L) (hLs : L < 1 - s) (hgate : D ≤ C * p * L) :
    D < C * p * (1 - s) := by
  have hCpL : 0 < C * p * L := by linarith
  have hCp : 0 < C * p := by
    by_contra h; push_neg at h; nlinarith
  nlinarith

end Nightshift.Guardian
