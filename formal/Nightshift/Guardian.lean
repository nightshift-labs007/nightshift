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
  sorry

-- G2: the Guardian never sells more collateral than exists
theorem sellAmount_le_collateral : sellAmount C p L D T s ≤ C := by
  sorry

-- G3: the sale restores health exactly to the target
theorem sellAmount_reaches_target :
    hfAfter C p L D s (sellAmount C p L D T s) = T := by
  sorry

-- G3b: minimality: any smaller sale stays below target (never oversells)
theorem sellAmount_minimal {c : ℝ} (hc0 : 0 ≤ c)
    (hc : c < sellAmount C p L D T s) : hfAfter C p L D s c < T := by
  sorry
end

-- G4: if collateral after slippage cannot cover the debt, selling never helps
theorem no_sell_when_insolvent {C p L D s c : ℝ}
    (hp : 0 < p) (hL : 0 < L) (hs1 : s < 1) (hc0 : 0 ≤ c) (hcC : c ≤ C)
    (hins : C * p * (1 - s) ≤ D) (hden : 0 < D - c * p * (1 - s)) :
    hfAfter C p L D s c ≤ hf C p L D := by
  sorry

-- G5: the on-chain gate (protect only runs while health ≥ 1) already implies the solvency
-- condition of G1–G3 whenever the market's LLTV is below 1 − slippage (0.77 < 0.995)
theorem healthy_gate_solvent {C p L D s : ℝ}
    (hD : 0 < D) (hL : 0 < L) (hLs : L < 1 - s) (hgate : D ≤ C * p * L) :
    D < C * p * (1 - s) := by
  sorry

end Nightshift.Guardian
