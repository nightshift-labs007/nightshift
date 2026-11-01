import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./enums";
import { loadTaxonomy } from "./taxonomy";

describe("taxonomy.yaml", () => {
  it("covers every category and caps candidates at 4", () => {
    const t = loadTaxonomy();
    for (const c of CATEGORIES) expect(t.categories[c].candidates.length).toBeLessThanOrEqual(4);
    expect(t.categories.other.enabled).toBe(false);
  });
});
