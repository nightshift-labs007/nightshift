import { basketHash } from "@nightshift-signals/chain";
import { makeEvent, newId, type Envelope } from "@nightshift-signals/core";
import { baskets, commits, deliveries, eq, grades, rowsToBasket, basketLegs, sources } from "@nightshift-signals/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TickRecorder } from "../market/prices";
import { registerPipeline } from "../pipeline";
import { makeTestDeps, rawHeadline } from "../testing";
import { gradeDay } from "./grade";
import { pollAllSources } from "./ingest";
import { onBasketCommitted } from "./publish";

// Thursday 2026-10-22, 02:00 ET: news breaks overnight; graded at 09:45 ET the same morning.
const t = await makeTestDeps(new Date("2026-10-22T06:00:00Z"));
const { deps, bus, news, market, telegram } = t;
const wire = { id: newId("source"), kind: "rss" as const, name: "Wire", url: "https://w.example/rss" };
const recorder = new TickRecorder(deps);
const published = () => bus.published.filter((e): e is Envelope<"basket.published"> => e.type === "basket.published");

beforeAll(async () => {
  await deps.db.insert(sources).values(wire);
  await t.seedTokens();
  registerPipeline(deps);
  await recorder.record({ symbol: "SPY", px: "600", src: "dex", ts: deps.now() });
});
afterAll(() => t.close());

describe("the loop: headline to graded basket", () => {
  it("commits before it shows, then publishes to every channel at once", async () => {
    news.feeds.set(wire.url, [rawHeadline("Tanker attacked in Strait of Hormuz", "x-1")]);
    await pollAllSources(deps);
    await bus.idle();

    const [p] = published();
    expect(p).toBeDefined();
    const id = p!.payload.basket_id;
    const [row] = await deps.db.select().from(baskets).where(eq(baskets.id, id));
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, id));
    const [commit] = await deps.db.select().from(commits).where(eq(commits.basketId, id));

    expect(row?.status).toBe("published");
    expect(row?.canonicalHash).toBe(basketHash(rowsToBasket(row!, legs)));
    expect(commit).toMatchObject({ hash: row!.canonicalHash, status: "confirmed", chainId: 0 });
    expect(row?.commitTx).toBe(commit!.txHash);

    // The commit event precedes the publish event.
    const order = bus.published.map((e) => e.type);
    expect(order.indexOf("basket.committed")).toBeLessThan(order.indexOf("basket.published"));

    expect(telegram.baskets).toHaveLength(1);
    expect(telegram.baskets[0]).toMatchObject({ simulated: true, url: `https://nightshift-signals.test/b/${id}` });
    const sent = await deps.db.select().from(deliveries).where(eq(deliveries.basketId, id));
    expect(sent.map((d) => d.channel).sort()).toEqual(["telegram", "ws"]);
    expect(new Set(sent.map((d) => d.sentAt.getTime())).size).toBe(1);
    expect(bus.deadLetters).toEqual([]);
  });

  it("refuses to publish a basket whose commit hash does not match", async () => {
    const [row] = await deps.db.select().from(baskets).where(eq(baskets.id, published()[0]!.payload.basket_id));
    const forged = { ...row!, id: "bkt_20261022_0600_forged", eventId: newId("event") };
    const { events } = await import("@nightshift-signals/db");
    await deps.db.insert(events).values({ id: forged.eventId, title: "x", firstSeenAt: deps.now() });
    await deps.db.insert(baskets).values({ ...forged, status: "draft", publishedAt: null, commitTx: null });
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, row!.id));
    await deps.db.insert(basketLegs).values(legs.map((l) => ({ ...l, basketId: forged.id })));
    await deps.db.insert(commits).values({ basketId: forged.id, hash: `0x${"00".repeat(32)}`, txHash: `0x${"11".repeat(32)}`, chainId: 0, status: "confirmed" });

    await onBasketCommitted(
      deps,
      makeEvent("basket.committed", { basket_id: forged.id, hash: `0x${"00".repeat(32)}`, tx_hash: null, status: "confirmed", block_time: null }, { producer: "t", correlation_id: "x" }),
    );
    const [after] = await deps.db.select().from(baskets).where(eq(baskets.id, forged.id));
    expect(after?.status).toBe("draft");
    expect(t.logs.some((l) => l.includes("REFUSED"))).toBe(true);
    await deps.db.update(baskets).set({ status: "void", voidReason: "stale" }).where(eq(baskets.id, forged.id));
  });

  it("grades at 9:45 ET on the executable exit vs SPY", async () => {
    t.advance(7 * 3600 * 1000 + 45 * 60 * 1000); // 13:45Z = 09:45 EDT
    const id = published()[0]!.payload.basket_id;
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, id));
    for (const l of legs) market.prices.set(l.tokenSymbol, market.px(l.tokenSymbol) * 1.02);
    await recorder.record({ symbol: "SPY", px: "603", src: "dex", ts: deps.now() });

    const summary = await gradeDay(deps, "2026-10-22");
    expect(summary.graded).toEqual([id]);

    const [g] = await deps.db.select().from(grades).where(eq(grades.basketId, id));
    expect(g).toMatchObject({ spyEntry: "600.000000000000000000", spyExit: "603.000000000000000000", hit: true });
    // +2% minus round-trip slippage beats SPY's +0.5%.
    expect(Number(g!.retPct)).toBeGreaterThan(0.015);
    expect(Number(g!.retPct)).toBeLessThan(0.02);
    const [row] = await deps.db.select().from(baskets).where(eq(baskets.id, id));
    expect(row?.status).toBe("graded");
    expect(bus.published.some((e) => e.type === "basket.graded")).toBe(true);

    expect((await gradeDay(deps, "2026-10-22")).graded).toEqual([]); // idempotent
  });

  it("voids a basket whose pool is paused at the open, and lists it", async () => {
    t.advance(-7 * 3600 * 1000); // back to overnight
    await recorder.record({ symbol: "SPY", px: "601", src: "dex", ts: deps.now() });
    for (const s of ["XLE", "GLD", "ITA", "SMH"]) market.prices.set(s, 100); // undo the morning rally, or the sizer drops legs as priced in
    news.feeds.set(wire.url, [rawHeadline("US widens export curbs on AI chips to China", "x-2")]);
    await pollAllSources(deps);
    await bus.idle();
    const id = published().at(-1)!.payload.basket_id;
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, id));
    market.paused.add(legs[0]!.tokenSymbol);
    t.advance(7 * 3600 * 1000);

    const summary = await gradeDay(deps, "2026-10-22");
    expect(summary.voided).toEqual([{ basket_id: id, reason: "pool_paused" }]);
    const [row] = await deps.db.select().from(baskets).where(eq(baskets.id, id));
    expect(row).toMatchObject({ status: "void", voidReason: "pool_paused" });
    expect(row?.canonicalHash).not.toBeNull();
    market.paused.clear();
  });
});
