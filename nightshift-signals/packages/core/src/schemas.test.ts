import { describe, expect, it } from "vitest";
import { BasketId, newBasketId, newId, EventId } from "./ids";
import { Basket } from "./schemas/basket";
import { User } from "./schemas/user";
import { sampleBasket } from "./testing";

const HASH = `0x${"ab".repeat(32)}`;

function issues(input: unknown) {
  const r = Basket.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("ids", () => {
  it("formats basket ids as bkt_YYYYMMDD_HHMM_suffix in UTC", () => {
    const id = newBasketId(new Date("2026-10-21T06:14:59Z"));
    expect(id).toMatch(/^bkt_20261021_0614_[a-z0-9]{8}$/);
    expect(BasketId.parse(id)).toBe(id);
  });

  it("makes prefixed ULIDs that validate", () => {
    expect(EventId.safeParse(newId("event")).success).toBe(true);
    expect(EventId.safeParse(newId("user")).success).toBe(false);
  });
});

describe("Basket", () => {
  it("accepts the deck example", () => {
    expect(issues(sampleBasket())).toEqual([]);
  });

  it("requires 2-4 legs", () => {
    const b = sampleBasket();
    expect(issues({ ...b, legs: [{ ...b.legs[0]!, weight: 1 }] }).length).toBeGreaterThan(0);
  });

  it("caps each leg at 0.5 and requires weights to sum to 1", () => {
    const b = sampleBasket();
    const heavy = b.legs.map((l, i) => ({ ...l, weight: i === 0 ? 0.6 : 0.2 }));
    expect(issues({ ...b, legs: heavy }).length).toBeGreaterThan(0);
    const short = b.legs.map((l) => ({ ...l, weight: 0.3 }));
    expect(issues({ ...b, legs: short }).join()).toMatch(/sum to 1/);
  });

  it("rejects duplicate tokens and legs over the slippage cap", () => {
    const b = sampleBasket();
    const dup = [b.legs[0]!, { ...b.legs[0]!, weight: 0.3 }, b.legs[2]!];
    expect(issues({ ...b, legs: dup }).join()).toMatch(/duplicate/);
    const slippy = b.legs.map((l) => ({ ...l, est_slippage_bps: 120 }));
    expect(issues({ ...b, legs: slippy }).join()).toMatch(/slippage/);
  });

  it("caps the thesis at 240 characters", () => {
    expect(issues(sampleBasket({ thesis: "x".repeat(241) })).length).toBeGreaterThan(0);
  });

  it("will not mark a basket published without a hash (commit before you show)", () => {
    const published = sampleBasket({ status: "published", published_at: "2026-10-21T06:14:40Z" });
    expect(issues(published).join()).toMatch(/canonical_hash/);
    expect(issues({ ...published, canonical_hash: HASH })).toEqual([]);
  });

  it("ties void_reason to status void", () => {
    expect(issues(sampleBasket({ status: "void" })).length).toBeGreaterThan(0);
    expect(issues(sampleBasket({ status: "void", void_reason: "illiquid" }))).toEqual([]);
    expect(issues(sampleBasket({ void_reason: "illiquid" })).length).toBeGreaterThan(0);
  });

  it("keeps money as decimal strings", () => {
    const b = sampleBasket();
    const floaty = b.legs.map((l) => ({ ...l, entry_quote_price: 92.15 }));
    expect(issues({ ...b, legs: floaty }).length).toBeGreaterThan(0);
  });
});

describe("User", () => {
  it("needs a wallet or an email", () => {
    const base = { id: newId("user"), lang: "en", country: "IN", tier: "free", created_at: "2026-10-21T00:00:00Z" };
    expect(User.safeParse({ ...base, wallet: null, email: null }).success).toBe(false);
    expect(User.safeParse({ ...base, wallet: null, email: "a@b.co" }).success).toBe(true);
  });
});
