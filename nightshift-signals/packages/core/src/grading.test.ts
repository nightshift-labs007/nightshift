import { describe, expect, it } from "vitest";
import { computeScorecard, gradeBasket, scorecardCsv, type ScoreRow } from "./grading";

describe("gradeBasket", () => {
  it("grades on stored entry quotes against SPY", () => {
    const g = gradeBasket(
      [
        { token_symbol: "XLE", weight: 0.5, entry_quote_price: "100", exit_price: "102", exit_open_print: null },
        { token_symbol: "GLD", weight: 0.5, entry_quote_price: "200", exit_price: "199", exit_open_print: "199.2" },
      ],
      { entry: "600", exit: "603" },
    );
    expect(g.legs.map((l) => l.ret_pct)).toEqual(["0.0200000000", "-0.0050000000"]);
    expect(g.ret_pct).toBe("0.0075000000");
    expect(g.spy_ret_pct).toBe("0.0050000000");
    expect(g.vs_spy_pct).toBe("0.0025000000");
    expect(g.hit).toBe(true);
  });

  it("counts a tie with SPY as a miss", () => {
    const g = gradeBasket([{ token_symbol: "X", weight: 1, entry_quote_price: "1", exit_price: "1.01", exit_open_print: null }], { entry: "1", exit: "1.01" });
    expect(g.hit).toBe(false);
  });
});

describe("computeScorecard", () => {
  const row = (id: string, alpha: number, confidence: number, category: ScoreRow["category"] = "geopolitics_energy"): ScoreRow => ({
    basket_id: id,
    category,
    confidence,
    published_at: "2026-10-21T06:00:00Z",
    status: "graded",
    void_reason: null,
    ret_pct: String(alpha + 0.001),
    vs_spy_pct: String(alpha),
    hit: alpha > 0,
  });

  it("reports hit rate, alpha, the worst basket, and calibration buckets", () => {
    const s = computeScorecard([
      row("a", 0.01, 0.65),
      row("b", -0.02, 0.45, "semis_export"),
      row("c", 0.005, 0.62),
      { ...row("d", 0, 0.5), status: "void", void_reason: "pool_paused", ret_pct: null, vs_spy_pct: null, hit: null },
    ]);
    expect(s.graded).toBe(3);
    expect(s.voids).toBe(1);
    expect(s.hit_rate).toBeCloseTo(2 / 3);
    expect(s.median_alpha).toBe(0.005);
    expect(s.worst).toEqual({ basket_id: "b", vs_spy_pct: -0.02 });
    expect(s.by_confidence.find((b) => b.key === "0.6-0.7")).toMatchObject({ n: 2, hit_rate: 1 });
    expect(s.by_category.map((b) => b.key)).toEqual(["geopolitics_energy", "semis_export"]);
  });
});

describe("scorecardCsv", () => {
  it("quotes fields that contain commas", () => {
    const csv = scorecardCsv([
      {
        basket_id: "bkt_1", published_at: "t", category: "c", confidence: 0.6, status: "graded", void_reason: "",
        canonical_hash: "0x1", commit_tx: "0x2", token_symbol: "XLE", weight: 0.5, entry_quote_price: "1", exit_price: "2",
        spy_entry: "1", spy_exit: "1", ret_pct: "1", vs_spy_pct: "1", hit: "true,really",
      },
    ]);
    expect(csv.split("\n")[1]).toMatch(/"true,really"$/);
  });
});
