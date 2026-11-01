import { makeEvent, newId, type Envelope } from "@nightshift-signals/core";
import { aiCalls, events, sources, eq } from "@nightshift-signals/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerPipeline } from "../pipeline";
import { makeTestDeps, rawHeadline } from "../testing";
import { pollAllSources } from "./ingest";
import { onEventTriaged } from "./map";

const t = await makeTestDeps();
const { deps, bus, news } = t;
const wires = ["A", "B", "C"].map((n) => ({ id: newId("source"), kind: "rss" as const, name: `Wire ${n}`, url: `https://${n}.example/rss` }));

beforeAll(async () => {
  await deps.db.insert(sources).values(wires);
  await t.seedTokens();
  registerPipeline(deps);
});
afterAll(() => t.close());

const proposals = () => bus.published.filter((e): e is Envelope<"basket.proposed"> => e.type === "basket.proposed");

describe("triage + mapping", () => {
  it("turns a severity-4 headline into a proposed basket of eligible tokens", async () => {
    news.feeds.set(wires[0]!.url, [rawHeadline("Tanker attacked in Strait of Hormuz", "h-1")]);
    await pollAllSources(deps);
    await bus.idle();

    const [p] = proposals();
    expect(p?.payload.legs.map((l) => l.underlying_ticker)).toEqual(["XLE", "GLD"]);
    expect(p?.payload.model_version).toBe("claude-sonnet-5-5");
    expect(p?.payload.basket_id).toMatch(/^bkt_20261021_0600_/);
    expect((await deps.db.select().from(aiCalls)).map((c) => c.kind)).toEqual(["triage", "map"]);
  });

  it("never offers SPY or other ineligible tokens to the model", () => {
    const mapCall = t.model.calls.find((c) => c.model === "claude-sonnet-5-5")!;
    expect(mapCall.user).not.toMatch(/SPY/);
  });

  it("stores noise without mapping it", async () => {
    news.feeds.set(wires[0]!.url, [rawHeadline("Local bakery wins award", "h-2")]);
    await pollAllSources(deps);
    await bus.idle();
    const [ev] = await deps.db.select().from(events).where(eq(events.title, "Local bakery wins award"));
    expect(ev?.severity).toBe(1);
    expect(proposals()).toHaveLength(1);
  });

  it("boosts severity once three sources corroborate, without a second basket", async () => {
    news.feeds.set(wires[1]!.url, [rawHeadline("Tanker attacked in Strait of Hormuz", "h-3")]);
    news.feeds.set(wires[2]!.url, [rawHeadline("Tanker attacked in Strait of Hormuz", "h-4")]);
    await pollAllSources(deps);
    await bus.idle();
    const [ev] = await deps.db.select().from(events).where(eq(events.title, "Tanker attacked in Strait of Hormuz"));
    expect(ev?.corroborated).toBe(true);
    expect(ev?.severity).toBe(5);
    expect(bus.deadLetters).toEqual([]);
  });

  it("publishes no basket for an event older than five minutes", async () => {
    const id = newId("event");
    await deps.db.insert(events).values({ id, title: "US widens export curbs on AI chips", firstSeenAt: new Date(deps.now().getTime() - 6 * 60 * 1000) });
    await onEventTriaged(
      deps,
      makeEvent(
        "event.triaged",
        { event_id: id, is_market_moving: true, category: "semis_export", severity: 4, regions: [], entities: [], corroborated: false },
        { producer: "test", correlation_id: id },
      ),
    );
    expect(t.logs.some((l) => /cutoff/.test(l))).toBe(true);
    expect(proposals()).toHaveLength(1);
  });
});
