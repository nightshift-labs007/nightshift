import { basketCanonicalJson, newId } from "@nightshift-signals/core";
import { SAMPLE_EVENT_ID, sampleBasket } from "@nightshift-signals/core/testing";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./client";
import { basketToRows, rowsToBasket } from "./mappers";
import * as s from "./schema";

const handle = await openDb("pglite:memory");
const { db } = handle;
const query = async <T>(q: string) => (await db.execute(sql.raw(q))) as unknown as { rows: T[] };

/** Postgres error message, unwrapped from Drizzle's query error. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { cause?: { message?: string }; message: string };
    return err.cause?.message ?? err.message;
  }
  throw new Error("expected the query to fail");
}

const embedding = (hot: number) => Array.from({ length: s.EMBEDDING_DIM }, (_, i) => (i === hot ? 1 : 0));

beforeAll(async () => {
  await handle.migrate();
  const sourceId = newId("source");
  await db.insert(s.sources).values({ id: sourceId, kind: "rss", name: "Test wire", url: "https://example.com/rss" });
  await db.insert(s.events).values({ id: SAMPLE_EVENT_ID, title: "Tanker attacked in Strait of Hormuz", firstSeenAt: new Date() });
  await db.insert(s.headlines).values(
    [0, 1].map((hot) => ({
      id: newId("headline"),
      sourceId,
      sourceItemId: `item-${hot}`,
      url: `https://example.com/${hot}`,
      title: `Headline ${hot}`,
      receivedAt: new Date(),
      embedding: embedding(hot),
      eventId: SAMPLE_EVENT_ID,
    })),
  );
});

describe("migrations", () => {
  it("create the twelve deck tables plus the deliveries audit log", async () => {
    const { rows } = await query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ["sources", "headlines", "events", "baskets", "basket_legs", "commits", "tokens", "price_bars_1m", "grades", "users", "triggers", "positions", "deliveries"]) {
      expect(names).toContain(t);
    }
  });

  it("build the HNSW index and answer a cosine search", async () => {
    const { rows } = await query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'headlines_embedding_hnsw'",
    );
    expect(rows[0]?.indexdef).toMatch(/hnsw.*vector_cosine_ops/);
    const nearest = await db
      .select({ sourceItemId: s.headlines.sourceItemId })
      .from(s.headlines)
      .orderBy(sql`${s.headlines.embedding} <=> ${JSON.stringify(embedding(1))}::vector`)
      .limit(1);
    expect(nearest[0]?.sourceItemId).toBe("item-1");
  });
});

describe("baskets", () => {
  it("round-trip through the database without losing a digit", async () => {
    const basket = sampleBasket();
    const rows = basketToRows(basket);
    await db.insert(s.baskets).values(rows.basket);
    await db.insert(s.basketLegs).values(rows.legs);

    const [row] = await db.select().from(s.baskets).where(eq(s.baskets.id, basket.id));
    const legs = await db.select().from(s.basketLegs).where(eq(s.basketLegs.basketId, basket.id));
    const back = rowsToBasket(row!, legs);

    expect(legs[0]?.entryQuotePrice).toBe("92.150000000000000000");
    expect(back.legs.map((l) => l.token_symbol)).toEqual(["XLE", "GLD", "ITA"]);
    // What Postgres hands back must hash identically to what the mapper produced.
    expect(basketCanonicalJson(back)).toBe(basketCanonicalJson(basket));
  });

  it("refuse to publish without a hash (commit before you show)", async () => {
    const msg = await pgError(
      db.update(s.baskets).set({ status: "published", publishedAt: new Date() }).where(eq(s.baskets.id, sampleBasket().id)),
    );
    expect(msg).toMatch(/baskets_published_has_hash/);
  });

  it("refuse a leg heavier than 0.5", async () => {
    const leg = { ...basketToRows(sampleBasket()).legs[0]!, position: 9, tokenSymbol: "USO", weight: "0.6" };
    expect(await pgError(db.insert(s.basketLegs).values(leg))).toMatch(/basket_legs_weight_range/);
  });
});

describe("grades and deliveries", () => {
  it("allow one grade per basket", async () => {
    const grade = {
      basketId: sampleBasket().id,
      gradedAt: new Date(),
      legs: [],
      retPct: "0.0123",
      spyRetPct: "0.0040",
      spyEntry: "600",
      spyExit: "602.4",
      vsSpyPct: "0.0083",
      hit: true,
    };
    await db.insert(s.grades).values(grade);
    expect(await pgError(db.insert(s.grades).values(grade))).toMatch(/duplicate key/);
  });

  it("keep deliveries append-only", async () => {
    await db.insert(s.deliveries).values({ basketId: sampleBasket().id, channel: "ws", sentAt: new Date(), latencyMs: 41_000 });
    expect(await pgError(db.update(s.deliveries).set({ latencyMs: 1 }))).toMatch(/append-only/);
    expect(await pgError(db.delete(s.deliveries))).toMatch(/append-only/);
  });
});
