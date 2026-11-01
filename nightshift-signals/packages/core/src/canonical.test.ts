import { describe, expect, it } from "vitest";
import { basketCanonicalJson, canonicalJson, fixedDecimal } from "./canonical";
import { toJsonSchemas } from "./json-schema";
import { sampleBasket } from "./testing";

describe("canonicalJson", () => {
  it("sorts keys, strips whitespace and stringifies integers", () => {
    expect(canonicalJson({ b: 2, a: { d: [1, "x"], c: null } })).toBe('{"a":{"c":null,"d":["1","x"]},"b":"2"}');
  });

  it("drops undefined keys", () => {
    expect(canonicalJson({ a: undefined, b: true })).toBe('{"b":true}');
  });

  it("refuses raw floats", () => {
    expect(() => canonicalJson({ w: 0.45 })).toThrow(/fixed-decimal/);
  });
});

describe("basketCanonicalJson", () => {
  it("is independent of key order and post-commit fields", () => {
    const a = sampleBasket();
    const b = Object.fromEntries(Object.entries(sampleBasket()).reverse()) as typeof a;
    const later = sampleBasket({
      status: "published",
      published_at: "2026-10-21T06:14:40Z",
      canonical_hash: `0x${"ab".repeat(32)}`,
      thesis_i18n: { es: "El riesgo de envío sube el petróleo y el oro" },
    });
    expect(basketCanonicalJson(b)).toBe(basketCanonicalJson(a));
    expect(basketCanonicalJson(later)).toBe(basketCanonicalJson(a));
  });

  it("formats weights and confidence with fixed decimals", () => {
    const json = basketCanonicalJson(sampleBasket());
    expect(json).toContain('"weight":"0.450000"');
    expect(json).toContain('"confidence":"0.6200"');
    expect(json).toBe(JSON.stringify(JSON.parse(json)));
  });

  it("hashes equal prices equally however they are written", () => {
    const padded = sampleBasket();
    const short = sampleBasket({ legs: padded.legs.map((l) => ({ ...l, entry_quote_price: l.entry_quote_price.replace(/0+$/, "") })) });
    expect(basketCanonicalJson(short)).toBe(basketCanonicalJson(padded));
    expect(basketCanonicalJson(padded)).toContain('"entry_quote_price":"92.150000000000000000"');
  });

  it("changes when a committed field changes", () => {
    expect(basketCanonicalJson(sampleBasket({ thesis: "Different" }))).not.toBe(basketCanonicalJson(sampleBasket()));
  });
});

describe("toJsonSchemas", () => {
  it("emits a JSON Schema for every public object", () => {
    const schemas = toJsonSchemas() as Record<string, { type?: string; properties?: object }>;
    expect(schemas.Basket?.type).toBe("object");
    expect(Object.keys(schemas.Basket?.properties ?? {})).toContain("canonical_hash");
  });
});

describe("fixedDecimal", () => {
  it("pads, strips leading zeros and normalizes negative zero", () => {
    expect(fixedDecimal("92.15", 4)).toBe("92.1500");
    expect(fixedDecimal("007", 2)).toBe("7.00");
    expect(fixedDecimal("-0.0", 2)).toBe("0.00");
    expect(fixedDecimal("-1.5", 2)).toBe("-1.50");
  });

  it("refuses to round", () => {
    expect(() => fixedDecimal("1.234", 2)).toThrow(/more than 2/);
  });
});

describe("why_chain in the hash", () => {
  it("leaves baskets without a chain hashing exactly as before the field existed", () => {
    const json = basketCanonicalJson(sampleBasket());
    expect(json).not.toContain("why_chain");
    // Frozen copy of a pre-why_chain canonical string: if this changes, old onchain hashes stop verifying.
    expect(json.startsWith('{"analog_event_ids":[],"confidence":"0.6200","created_at":"2026-10-21T06:14:00.000Z"')).toBe(true);
  });

  it("commits the chain when present", () => {
    const withChain = sampleBasket({ why_chain: ["Tanker attacked", "Oil supply at risk"] });
    expect(basketCanonicalJson(withChain)).toContain('"why_chain":["Tanker attacked","Oil supply at risk"]');
    expect(basketCanonicalJson(withChain)).not.toBe(basketCanonicalJson(sampleBasket()));
  });
});
