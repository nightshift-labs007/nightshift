import Nightshift.Vault

/-!
Emits JSON test vectors computed by the Lean Vault model. `scripts/test-lean-vectors.mjs`
replays every case against the real `NightshiftVault` on a local chain and requires an exact match.
Run: `lake exe vectors > ../test/vectors/vectors.json`
-/

open Nightshift.Vault

/-- LLTVs for the pure `lif` function (includes out-of-market edge values). -/
def lifCases : List ℕ :=
  [0, 1, 625 * 10 ^ 15, 77 * 10 ^ 16, 86 * 10 ^ 16, 945 * 10 ^ 15, 10 ^ 18 - 1, 10 ^ 18]

/-- (collateral, price, lltv, confidence) for `collateralValue` and `borrowLimit`. -/
def limitCases : List (ℕ × ℕ × ℕ × ℕ) :=
  [ (10 * 10 ^ 18, 780 * 10 ^ 18, 77 * 10 ^ 16, 85)
  , (10 * 10 ^ 18, 780 * 10 ^ 18, 77 * 10 ^ 16, 100)
  , (10 * 10 ^ 18, 780 * 10 ^ 18, 77 * 10 ^ 16, 35)
  , (3 * 10 ^ 18 + 7, 123456789012345678901, 625 * 10 ^ 15, 73)
  , (1, 1, 77 * 10 ^ 16, 0)
  , (10 ^ 24, 2 * 10 ^ 21, 945 * 10 ^ 15, 99) ]

/-- (collateral, price at borrow, confidence, debt, price later, lltv) for `healthFactor`. -/
def hfCases : List (ℕ × ℕ × ℕ × ℕ × ℕ × ℕ) :=
  [ (10 * 10 ^ 18, 780 * 10 ^ 18, 85, 3000 * 10 ^ 18, 700 * 10 ^ 18, 77 * 10 ^ 16)
  , (10 * 10 ^ 18, 780 * 10 ^ 18, 85, 5000 * 10 ^ 18, 600 * 10 ^ 18, 77 * 10 ^ 16)
  , (5 * 10 ^ 18 + 3, 47 * 10 ^ 18 + 1, 50, 10 * 10 ^ 18 + 7, 47 * 10 ^ 18 + 1, 625 * 10 ^ 15)
  , (10 ^ 18, 10 ^ 18, 100, 1, 1, 77 * 10 ^ 16)
  , (2 * 10 ^ 18, 10 ^ 18 - 1, 100, 1539999999999999998, 10 ^ 18 - 1, 77 * 10 ^ 16) ]

def q (n : ℕ) : String := "\"" ++ toString n ++ "\""

def main : IO Unit := do
  let lifs := lifCases.map fun l => "{\"l\":" ++ q l ++ ",\"lif\":" ++ q (lif l) ++ "}"
  let limits := limitCases.map fun (c, p, l, conf) =>
    "{\"c\":" ++ q c ++ ",\"p\":" ++ q p ++ ",\"l\":" ++ q l ++ ",\"conf\":" ++ q conf ++
    ",\"value\":" ++ q (value c p) ++ ",\"borrowLimit\":" ++ q (borrowLimit c p l conf) ++ "}"
  let hfs := hfCases.map fun (c, p0, conf, d, p1, l) =>
    "{\"c\":" ++ q c ++ ",\"p0\":" ++ q p0 ++ ",\"conf\":" ++ q conf ++ ",\"d\":" ++ q d ++
    ",\"p1\":" ++ q p1 ++ ",\"l\":" ++ q l ++
    ",\"limitAtBorrow\":" ++ q (borrowLimit c p0 l conf) ++
    ",\"hf\":" ++ q (hf c p1 l d) ++
    ",\"liquidatable\":" ++ toString (decide (0 < d ∧ hf c p1 l d < WAD)) ++ "}"
  IO.println ("{\"lif\":[" ++ ",".intercalate lifs ++ "],\"limits\":[" ++ ",".intercalate limits ++
    "],\"hf\":[" ++ ",".intercalate hfs ++ "]}")
