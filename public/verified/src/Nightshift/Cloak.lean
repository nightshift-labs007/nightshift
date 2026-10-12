import Mathlib

/-!
# Cloak (models `zk/solvency.circom`, Groth16 over BN254)

Circuit: `units · priceCents · lltvBps > debtCents · 10^8`, with range checks
`units < 2^64`, `debtCents < 2^64`, `priceCents < 2^40`, `lltvBps < 2^14`, compared by
circomlib `GreaterThan(120)` (sound when both sides are below 2^120).
Bit budget: 64 + 40 + 14 = 118 bits for the capacity, 64 + 27 = 91 bits for the scaled debt,
far below the ~253.6-bit BN254 scalar field. No refactor is needed.
-/

namespace Nightshift.Cloak

/-- BN254 scalar field modulus (the field Groth16 / Circom compute in). -/
def BN254_R : ℕ :=
  21888242871839275222246405745257275088548364400416034343698204186575808495617

-- C1: range-checked inputs can never wrap around the field
theorem product_no_wrap (a b c i j k P : ℕ)
    (ha : a < 2 ^ i) (hb : b < 2 ^ j) (hc : c < 2 ^ k)
    (hP : 2 ^ (i + j + k) ≤ P) : a * b * c < P := by
  have h1 : a * b < 2 ^ i * 2 ^ j := Nat.mul_lt_mul'' ha hb
  have h2 : a * b * c < 2 ^ i * 2 ^ j * 2 ^ k := Nat.mul_lt_mul'' h1 hc
  calc a * b * c < 2 ^ i * 2 ^ j * 2 ^ k := h2
    _ = 2 ^ (i + j + k) := by rw [pow_add, pow_add]
    _ ≤ P := hP

-- C1a: instantiated with the circuit's real widths: capacity fits in 118 bits, inside BN254
theorem capacity_fits (u p l : ℕ) (hu : u < 2 ^ 64) (hp : p < 2 ^ 40) (hl : l < 2 ^ 14) :
    u * p * l < 2 ^ 118 ∧ 2 ^ 118 < BN254_R := by
  refine ⟨product_no_wrap u p l 64 40 14 _ hu hp hl le_rfl, ?_⟩
  unfold BN254_R; norm_num

-- C1b: the scaled debt also fits under GreaterThan(120)'s 2^120 bound
theorem need_fits (d : ℕ) (hd : d < 2 ^ 64) : d * 10 ^ 8 < 2 ^ 120 := by
  calc d * 10 ^ 8 < 2 ^ 64 * 10 ^ 8 := Nat.mul_lt_mul_of_pos_right hd (by norm_num)
    _ ≤ 2 ^ 120 := by norm_num

-- C2: below the modulus, field values equal integer values,
-- so the in-circuit comparison matches the integer comparison
theorem field_val_eq (P x : ℕ) [NeZero P] (hx : x < P) :
    (x : ZMod P).val = x := by
  exact ZMod.val_cast_of_lt hx

-- C3: conservative rounding is sound: a check passed on rounded-down
-- collateral and rounded-up debt implies the exact check
theorem conservative_rounding (coll collDown debt debtUp : ℕ)
    (h1 : collDown ≤ coll) (h2 : debt ≤ debtUp)
    (pass : debtUp ≤ collDown) : debt ≤ coll := by
  omega

/-- The statement the circuit enforces. -/
def circuitSolvent (units priceCents lltvBps debtCents : ℕ) : Prop :=
  debtCents * 10 ^ 8 < units * priceCents * lltvBps

-- C4: a proof made from collateral rounded down and debt rounded up implies
-- solvency of the true (unrounded) position at the same price and LLTV
theorem circuit_sound_rounding {units unitsTrue debtCents debtTrue p l : ℕ}
    (hu : units ≤ unitsTrue) (hd : debtTrue ≤ debtCents)
    (h : circuitSolvent units p l debtCents) : circuitSolvent unitsTrue p l debtTrue := by
  unfold circuitSolvent at *
  calc debtTrue * 10 ^ 8 ≤ debtCents * 10 ^ 8 := Nat.mul_le_mul_right _ hd
    _ < units * p * l := h
    _ ≤ unitsTrue * p * l := Nat.mul_le_mul_right _ (Nat.mul_le_mul_right _ hu)

end Nightshift.Cloak
