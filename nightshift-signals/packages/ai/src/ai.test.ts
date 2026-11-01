import { loadTaxonomy } from "@nightshift-signals/core/taxonomy";
import { describe, expect, it } from "vitest";
import { FakeJsonModel } from "./fake";
import { normalizeWeights } from "@nightshift-signals/core";
import { checkProposal, proposeBasket, type MapInput } from "./mapper";
import { triageHeadlines } from "./triage";

const taxonomy = loadTaxonomy();
const input: MapInput = {
  category: "geopolitics_energy",
  severity: 4,
  headlines: [{ title: "Tanker attacked in Strait of Hormuz, Brent crude jumps 4%", summary: null }],
  eligible: [
    { underlying_ticker: "XLE", name: "Energy Select Sector SPDR", fv_gap_bps: 40, fv_frozen: false },
    { underlying_ticker: "GLD", name: "SPDR Gold Shares", fv_gap_bps: null, fv_frozen: false },
    { underlying_ticker: "ITA", name: "iShares US Aerospace & Defense", fv_gap_bps: -10, fv_frozen: false },
  ],
  analogs: [],
};
const good = {
  skip: false,
  skip_reason: "",
  thesis: "Shipping risk in Hormuz lifts oil producers and haven gold.",
  cited_text: "Brent crude jumps 4%",
  legs: [
    { underlying_ticker: "XLE", weight: 0.45 },
    { underlying_ticker: "GLD", weight: 0.3 },
    { underlying_ticker: "ITA", weight: 0.25 },
  ],
  confidence: 0.62,
};

describe("checkProposal", () => {
  it("accepts a clean proposal", () => {
    expect(checkProposal(good, input)).toMatchObject({ proposal: { confidence: 0.62 } });
  });

  it.each([
    ["an ineligible ticker", { legs: [{ underlying_ticker: "TSLA", weight: 0.5 }, { underlying_ticker: "XLE", weight: 0.5 }] }, /not eligible/],
    ["a leg over 0.5", { legs: [{ underlying_ticker: "XLE", weight: 0.7 }, { underlying_ticker: "GLD", weight: 0.3 }] }, /weight must be/],
    ["one leg", { legs: [{ underlying_ticker: "XLE", weight: 1 }] }, /2-4 legs/],
    ["a price target", { thesis: "XLE to $105 on supply fears." }, /price targets/],
    ["an invented citation", { cited_text: "oil hits record" }, /exact phrase/],
    ["weights that do not sum to 1", { legs: [{ underlying_ticker: "XLE", weight: 0.3 }, { underlying_ticker: "GLD", weight: 0.3 }] }, /sum to/],
  ])("rejects %s", (_, patch, msg) => {
    const res = checkProposal({ ...good, ...patch }, input);
    expect("errors" in res && res.errors.join()).toMatch(msg);
  });
});

describe("normalizeWeights", () => {
  it("sums to exactly 1 and respects the 0.5 cap after renormalizing", () => {
    const w = normalizeWeights([{ weight: 0.5 }, { weight: 0.3 }]).map((l) => l.weight);
    expect(w).toEqual([0.5, 0.5]);
    const three = normalizeWeights([{ weight: 0.333 }, { weight: 0.333 }, { weight: 0.333 }]).map((l) => l.weight);
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(Math.max(...three)).toBeLessThanOrEqual(0.5);
  });
});

describe("proposeBasket", () => {
  it("offers only eligible tickers in the schema enum", async () => {
    const model = new FakeJsonModel(() => good);
    await proposeBasket(model, taxonomy, input);
    const schema = model.calls[0]!.schema as { properties: { legs: { items: { properties: { underlying_ticker: { enum: string[] } } } } } };
    expect(schema.properties.legs.items.properties.underlying_ticker.enum).toEqual(["XLE", "GLD", "ITA"]);
    expect(model.calls[0]!.model).toBe("claude-sonnet-5-5");
  });

  it("retries once with the broken rules, then drops", async () => {
    const model = new FakeJsonModel(() => ({ ...good, cited_text: "made up" }));
    const res = await proposeBasket(model, taxonomy, input);
    expect(res).toMatchObject({ kind: "dropped" });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.user).toMatch(/broke these rules/);
  });

  it("recovers when the retry is valid", async () => {
    let n = 0;
    const model = new FakeJsonModel(() => (n++ === 0 ? { ...good, legs: [] } : good));
    expect(await proposeBasket(model, taxonomy, input)).toMatchObject({ kind: "proposal" });
  });

  it("passes through a skip and a refusal", async () => {
    expect(await proposeBasket(new FakeJsonModel(() => ({ ...good, skip: true, skip_reason: "priced in" })), taxonomy, input)).toEqual({
      kind: "skip",
      reason: "priced in",
    });
    expect(await proposeBasket(new FakeJsonModel(() => null), taxonomy, input)).toMatchObject({ kind: "dropped", reason: "refusal" });
  });

  it("keeps the system prompt identical across calls so it caches", async () => {
    const model = new FakeJsonModel(() => good);
    await proposeBasket(model, taxonomy, input);
    await proposeBasket(model, taxonomy, { ...input, severity: 5 });
    expect(model.calls[0]!.system).toBe(model.calls[1]!.system);
  });
});

describe("triageHeadlines", () => {
  it("validates output and truncates the reason", async () => {
    const model = new FakeJsonModel(() => ({
      is_market_moving: true,
      category: "geopolitics_energy",
      regions: ["Iran"],
      severity: 4,
      entities: ["Brent"],
      reason: "x".repeat(300),
    }));
    const t = await triageHeadlines(model, taxonomy, { headlines: [{ title: "Tanker attacked", summary: null, source: "Wire" }] });
    expect(t.severity).toBe(4);
    expect(t.reason).toHaveLength(160);
    expect(model.calls[0]!.model).toBe("claude-haiku-5-5");
  });

  it("throws after a second invalid answer", async () => {
    await expect(triageHeadlines(new FakeJsonModel(() => ({ severity: 9 })), taxonomy, { headlines: [] })).rejects.toThrow(/triage failed/);
  });
});

describe("whyChain", () => {
  it("keeps 2-4 short steps and drops anything else without rejecting the basket", async () => {
    const { whyChain } = await import("./mapper");
    expect(whyChain(["a", "b"])).toEqual(["a", "b"]);
    expect(whyChain(["only one"])).toEqual([]);
    expect(whyChain(["a", "b", "c", "d", "e"])).toEqual([]);
    expect(whyChain(["a", "x".repeat(81)])).toEqual([]);
    const res = checkProposal({ ...good, why_chain: "not a list" }, input);
    expect("proposal" in res && res.proposal.why_chain).toEqual([]);
  });
});

describe("morning brief", () => {
  const input = {
    date: "2026-10-22",
    hit_rate: 0.5,
    graded: [
      { thesis: "a", ret_pct: "0.012", vs_spy_pct: "0.004", hit: true },
      { thesis: "b", ret_pct: "-0.01", vs_spy_pct: "-0.013", hit: false },
    ],
    voids: 1,
  };

  it("has a plain template in every language that names misses and ends with the label", async () => {
    const { templateBrief } = await import("./brief");
    expect(templateBrief(input, "en")).toBe(
      "Nightshift Signals morning brief for 2026-10-22. Of last night's 2 baskets, 1 beat SPY. Basket 1: beat SPY by 0.4 percent. Basket 2: trailed SPY by 1.3 percent. 1 were voided. Information, not advice.",
    );
    expect(templateBrief(input, "hi")).toContain("यह जानकारी है, सलाह नहीं।");
    expect(templateBrief(input, "es")).toContain("quedó 1.3 por ciento detrás del SPY");
  });

  it("falls back when the model output is unusable", async () => {
    const { writeBrief } = await import("./brief");
    expect(await writeBrief(new FakeJsonModel(() => ({ script: "too short" })), input, "en")).toBeNull();
    expect(await writeBrief(new FakeJsonModel(() => null), input, "en")).toBeNull();
  });
});
