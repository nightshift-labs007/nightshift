import { makeEvent, newBasketId, newId, type Envelope } from "@nightshift-signals/core";
import { basketLegs, baskets, eq, events, FairValueService, priceBars1m, tokens } from "@nightshift-signals/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerPipeline } from "../pipeline";
import { onBasketProposed } from "../stages/size";
import { makeTestDeps } from "../testing";
import { DriftWatcher } from "./drift";
import { syncRegistry } from "./registry";
import { TickRecorder } from "./prices";

const t = await makeTestDeps(new Date("2026-10-22T06:00:00Z"));
const { deps, bus, market } = t;
const eventId = newId("event");

beforeAll(async () => {
  registerPipeline(deps);
  await deps.db.insert(events).values({ id: eventId, title: "Tanker attacked", firstSeenAt: deps.now(), category: "geopolitics_energy" });
});
afterAll(() => t.close());

function proposal(legs: { underlying_ticker: string; weight: number }[], eid = eventId) {
  return makeEvent(
    "basket.proposed",
    {
      basket_id: newBasketId(deps.now()),
      event_id: eid,
      thesis: "Shipping risk lifts oil and gold.",
      legs,
      confidence: 0.6,
      created_at: deps.now().toISOString(),
      model_version: "claude-sonnet-5-5",
      prompt_version: "map-v1",
      analog_event_ids: [],
    },
    { producer: "test", correlation_id: eid, now: deps.now() },
  );
}

describe("registry sync", () => {
  it("marks tokens eligible only with a liquid pool and a proxy", async () => {
    market.liquidity.set("ITA", 10_000);
    const res = await syncRegistry(deps);
    expect(res).toEqual({ eligible: 4, total: 5 });
    const [ita] = await deps.db.select().from(tokens).where(eq(tokens.symbol, "ITA"));
    expect(ita?.eligible).toBe(false);
    expect(ita?.poolFee).toBe(3000);
    expect(ita?.beta).toBe("0.900000"); // taxonomy default for conflict_defense
  });
});

describe("sizer", () => {
  it("quotes each leg at the reference size and writes a draft basket", async () => {
    await deps.db.update(tokens).set({ lastClose: "100" });
    const e = proposal([
      { underlying_ticker: "XLE", weight: 0.5 },
      { underlying_ticker: "GLD", weight: 0.5 },
    ]);
    await onBasketProposed(deps, e);
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, e.payload.basket_id));
    expect(legs.map((l) => l.entryQuoteSizeUsdg)).toEqual(["1000.000000000000000000", "1000.000000000000000000"]);
    // 1,000 USDG into a 500k pool costs ~12 bps in the sim
    expect(legs[0]!.estSlippageBps).toBeGreaterThan(5);
    expect(legs[0]!.estSlippageBps).toBeLessThan(20);
    const sized = bus.published.find((x): x is Envelope<"basket.sized"> => x.type === "basket.sized");
    expect(sized?.payload.voided).toBe(false);
  });

  it("drops legs over the slippage cap and voids a basket left with one leg", async () => {
    await deps.db.update(tokens).set({ eligible: true, poolLiquidityUsdg: "10000" }).where(eq(tokens.symbol, "ITA"));
    const eid = newId("event");
    await deps.db.insert(events).values({ id: eid, title: "Defense", firstSeenAt: deps.now(), category: "conflict_defense" });
    const e = proposal([{ underlying_ticker: "ITA", weight: 0.5 }, { underlying_ticker: "XLE", weight: 0.5 }], eid);
    await onBasketProposed(deps, e);
    const [b] = await deps.db.select().from(baskets).where(eq(baskets.id, e.payload.basket_id));
    expect(b).toMatchObject({ status: "void", voidReason: "illiquid" });
    const sized = bus.published.filter((x): x is Envelope<"basket.sized"> => x.type === "basket.sized").at(-1);
    expect(sized?.payload.dropped[0]?.reason).toMatch(/^slippage_/);
  });

  it("drops a leg that already moved past the category's typical reaction", async () => {
    market.prices.set("XLE", 103); // +300 bps since the 100 close; typical oil move is 150
    const eid = newId("event");
    await deps.db.insert(events).values({ id: eid, title: "Oil", firstSeenAt: deps.now(), category: "geopolitics_energy" });
    const e = proposal([{ underlying_ticker: "XLE", weight: 0.5 }, { underlying_ticker: "GLD", weight: 0.3 }, { underlying_ticker: "SMH", weight: 0.2 }], eid);
    await onBasketProposed(deps, e);
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, e.payload.basket_id));
    expect(legs.map((l) => l.tokenSymbol)).toEqual(["GLD", "SMH"]);
    expect(legs.map((l) => Number(l.weight))).toEqual([0.5, 0.5]);
    market.prices.set("XLE", 100);
  });
});

describe("fair value", () => {
  it("computes FV from the proxy move since the close and alerts on drift", async () => {
    const recorder = new TickRecorder(deps);
    // ES closed at 6800 (last bar before 16:00 ET on Oct 21), now 6868 (+1%).
    await deps.db.insert(priceBars1m).values({ symbol: "ES", ts: new Date("2026-10-21T19:59:00Z"), o: "6800", h: "6800", l: "6800", c: "6800", source: "futures" });
    await recorder.record({ symbol: "ES", px: "6868", src: "futures", ts: deps.now() });
    await recorder.record({ symbol: "XLE", px: "103", src: "dex", ts: deps.now() });
    await deps.db.update(tokens).set({ lastClose: "100", beta: "1.5" }).where(eq(tokens.symbol, "XLE"));

    const fv = new FairValueService(deps.db, deps.prices, deps.now);
    const xle = (await fv.gaps(["XLE"])).get("XLE")!;
    expect(xle.fv).toBe("101.500000000000000000");
    expect(xle.gap_bps).toBe(148);
    expect(xle.frozen).toBe(false);

    await recorder.record({ symbol: "XLE", px: "103.2", src: "dex", ts: new Date(deps.now().getTime() + 2000) });
    const drift = new DriftWatcher(deps, fv);
    expect(await drift.check()).toBe(1);
    expect(await drift.check()).toBe(0); // no re-alert within 30 minutes
  });
});

describe("TickRecorder", () => {
  it("never lets a backfilled tick replace a newer cached price", async () => {
    const r = new TickRecorder(deps);
    await r.record({ symbol: "GC", px: "4100", src: "futures", ts: new Date("2026-10-22T06:00:00Z") });
    await r.record({ symbol: "GC", px: "4000", src: "futures", ts: new Date("2026-10-21T19:59:00Z") });
    expect((await deps.prices.get("GC"))?.px).toBe("4100");
  });
});
