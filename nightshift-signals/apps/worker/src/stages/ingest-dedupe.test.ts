import { newId } from "@nightshift-signals/core";
import { events, headlines, sources, eq } from "@nightshift-signals/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerPipeline } from "../pipeline";
import { makeTestDeps, rawHeadline } from "../testing";
import { pollAllSources } from "./ingest";

const t = await makeTestDeps();
const { deps, bus, news } = t;
const wireA = { id: newId("source"), kind: "rss" as const, name: "Wire A", url: "https://a.example/rss" };
const wireB = { id: newId("source"), kind: "rss" as const, name: "Wire B", url: "https://b.example/rss" };
const tanker = "Tanker attacked in Strait of Hormuz, Brent crude jumps 4% in Asian trade";

beforeAll(async () => {
  await deps.db.insert(sources).values([wireA, wireB]);
  registerPipeline(deps);
});
afterAll(() => t.close());

async function poll() {
  await pollAllSources(deps);
  await bus.idle();
}

describe("ingest + dedupe", () => {
  it("clusters the same story from two sources into one event", async () => {
    news.feeds.set(wireA.url, [rawHeadline(tanker, "a-1")]);
    news.feeds.set(wireB.url, [rawHeadline(`${tanker}.`, "b-1")]);
    await poll();

    const all = await deps.db.select().from(events);
    expect(all).toHaveLength(1);
    expect(all[0]?.sourcesN).toBe(2);
    const clustered = bus.published.filter((e) => e.type === "event.clustered");
    expect(clustered.map((e) => (e.payload as { is_new: boolean }).is_new)).toEqual([true, false]);
    expect(new Set(clustered.map((e) => e.correlation_id)).size).toBe(1);
  });

  it("does not re-ingest items it has already seen", async () => {
    const before = (await deps.db.select().from(headlines)).length;
    await poll();
    expect((await deps.db.select().from(headlines)).length).toBe(before);
  });

  it("opens a new event for an unrelated story", async () => {
    news.feeds.set(wireA.url, [rawHeadline("Fed's Waller says December cut is not a done deal", "a-2")]);
    await poll();
    expect(await deps.db.select().from(events)).toHaveLength(2);
  });

  it("does not join a cluster older than 30 minutes", async () => {
    t.advance(31 * 60 * 1000);
    news.feeds.set(wireB.url, [rawHeadline(tanker, "b-2")]);
    await poll();
    const [h] = await deps.db.select().from(headlines).where(eq(headlines.sourceItemId, "b-2"));
    const [first] = await deps.db.select().from(headlines).where(eq(headlines.sourceItemId, "a-1"));
    expect(h?.eventId).not.toBe(first?.eventId);
    expect(bus.deadLetters).toEqual([]);
  });
});
