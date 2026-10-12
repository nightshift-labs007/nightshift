import Mathlib

/-!
# Oracle (models `computeQuote` in `lib/oracle.ts` and `learnWeights` in `lib/weights.ts`)

* Fair value: `Σ (weight_i / Σ weight) × estimate_i` over the 4–5 signal estimates.
* Learned weights: `0.5·prior_k + 0.5·priorSum·inv_k / Σ inv`, with `inv_k = 1 / (mse_k + 1e-8)`.
* Confidence: `round(clamp(98 − 0.3·hours − 0.5·dispersionBps − 10·simulated, 35, 98))`.
  The decay is linear in hours (not exponential) and also depends on signal dispersion, which
  can fall as markets move. So confidence is monotone in time only with dispersion held fixed
  (see O2 and `formal/MAPPING.md`). `Math.round` is monotone and maps [35, 98] into itself,
  so it preserves O2 and O3.
* There is no clamp or band on the fair value itself, so the spec's O4 does not apply.
-/

namespace Nightshift.Oracle

open scoped BigOperators

noncomputable def blend {n : ℕ} (w x : Fin n → ℝ) : ℝ := ∑ i, w i * x i

-- O1: the fair value always lies between the lowest and highest signal
theorem blend_within_signals {n : ℕ} (w x : Fin n → ℝ) (m M : ℝ)
    (hw : ∀ i, 0 ≤ w i) (hsum : ∑ i, w i = 1)
    (hm : ∀ i, m ≤ x i) (hM : ∀ i, x i ≤ M) :
    m ≤ blend w x ∧ blend w x ≤ M := by
  unfold blend
  constructor
  · calc m = ∑ i, w i * m := by rw [← Finset.sum_mul, hsum, one_mul]
      _ ≤ ∑ i, w i * x i := Finset.sum_le_sum fun i _ => mul_le_mul_of_nonneg_left (hm i) (hw i)
  · calc ∑ i, w i * x i ≤ ∑ i, w i * M :=
          Finset.sum_le_sum fun i _ => mul_le_mul_of_nonneg_left (hM i) (hw i)
      _ = M := by rw [← Finset.sum_mul, hsum, one_mul]

/-- The normalisation step in `computeQuote`: `a.weight = a.weight / wSum`. -/
noncomputable def normalize {n : ℕ} (w : Fin n → ℝ) : Fin n → ℝ := fun i => w i / ∑ j, w j

-- O1a: normalised weights are non-negative and sum to 1 (the invariant O1 relies on)
theorem normalize_invariant {n : ℕ} (w : Fin n → ℝ)
    (hw : ∀ i, 0 ≤ w i) (hpos : 0 < ∑ j, w j) :
    (∀ i, 0 ≤ normalize w i) ∧ ∑ i, normalize w i = 1 := by
  refine ⟨fun i => div_nonneg (hw i) hpos.le, ?_⟩
  unfold normalize
  rw [← Finset.sum_div, div_self hpos.ne']

/-- `learnWeights`: blend 50/50 of the prior and the prior mass split by inverse MSE. -/
noncomputable def learned (prior mse : Fin 3 → ℝ) (ε : ℝ) : Fin 3 → ℝ := fun k =>
  0.5 * prior k + 0.5 * (∑ j, prior j) * ((1 / (mse k + ε)) / ∑ j, 1 / (mse j + ε))

-- O1b: learned weights stay non-negative and keep the prior's total mass
theorem learned_invariant (prior mse : Fin 3 → ℝ) (ε : ℝ)
    (hprior : ∀ k, 0 ≤ prior k) (hmse : ∀ k, 0 ≤ mse k) (hε : 0 < ε) :
    (∀ k, 0 ≤ learned prior mse ε k) ∧ ∑ k, learned prior mse ε k = ∑ k, prior k := by
  have hpos : ∀ k, 0 < mse k + ε := fun k => by linarith [hmse k]
  have hinv : 0 < ∑ j, 1 / (mse j + ε) :=
    Finset.sum_pos (fun j _ => one_div_pos.mpr (hpos j)) Finset.univ_nonempty
  have hS : 0 ≤ ∑ j, prior j := Finset.sum_nonneg fun j _ => hprior j
  refine ⟨fun k => ?_, ?_⟩
  · unfold learned
    have := div_nonneg (one_div_pos.mpr (hpos k)).le hinv.le
    have := hprior k
    positivity
  · unfold learned
    rw [Finset.sum_add_distrib, ← Finset.mul_sum, ← Finset.mul_sum, ← Finset.sum_div,
      div_self hinv.ne']
    ring

noncomputable def clamp (lo hi v : ℝ) : ℝ := max lo (min hi v)

/-- Confidence before rounding, as a function of hours since the close. -/
noncomputable def confidence (dispersionBps simulated hours : ℝ) : ℝ :=
  clamp 35 98 (98 - 0.3 * hours - 0.5 * dispersionBps - 10 * simulated)

-- O2: with the signals' agreement unchanged, confidence never rises as closed hours pass
theorem confidence_antitone (dispersionBps simulated : ℝ) :
    Antitone (confidence dispersionBps simulated) := by
  intro a b hab
  unfold confidence clamp
  apply max_le_max le_rfl
  apply min_le_min le_rfl
  linarith

-- O2b: more disagreement between the signals never raises confidence
theorem confidence_antitone_dispersion (simulated hours : ℝ) :
    Antitone (fun d => confidence d simulated hours) := by
  intro a b hab
  unfold confidence clamp
  apply max_le_max le_rfl
  apply min_le_min le_rfl
  linarith

-- O3: confidence always stays between 35 and 98
theorem confidence_bounds (dispersionBps simulated hours : ℝ) :
    35 ≤ confidence dispersionBps simulated hours ∧ confidence dispersionBps simulated hours ≤ 98 := by
  unfold confidence clamp
  constructor
  · exact le_max_left _ _
  · exact max_le (by norm_num) (min_le_left _ _)

end Nightshift.Oracle
