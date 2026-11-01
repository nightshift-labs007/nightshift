// Replays one overnight session through the current prompts in an isolated in-memory database.
// Nothing touches production tables and nothing is committed onchain.
import { HashingEmbedder, VoyageEmbedder, type NewsSource } from "@nightshift-signals/adapters";
import { AnthropicJsonModel, MAP_PROMPT_VERSION, OfflineDemoModel, TRIAGE_PROMPT_VERSION } from "@nightshift-signals/ai";
import { SimulatedLedger } from "@nightshift-signals/chain";
import { computeScorecard, etToUtc, InMemoryBus, isTradingDay, lastClose, makeEvent, MemoryPriceCache, type ScoreRow } from "@nightshift-signals/core";
import { loadTaxonomy } from "@nightshift-signals/core/taxonomy";
import {
  and, asc, basketLegs, baskets, desc, EMBEDDING_DIM, eq, events, FairValueService, gte, grades, headlines, lt, lte, openDb, priceBars1m, sources, tokens, type DbHandle,
} from "@nightshift-signals/db";
import { DEFAULT_CONFIG, type Deps } from "@nightshift-signals/worker/deps";
import { BarExitPricer, gradeDay } from "@nightshift-signals/worker/grade";
import { registerPipeline } from "@nightshift-signals/worker/pipeline";
import { BarQuotes } from "./bar-quotes";

export async function runReplay(source: DbHandle, date: string, opts: { offline: boolean; label?: string; quiet?: boolean }) {
  const log = (m: string) => !opts.quiet && console.log(m);
  if (!isTradingDay(date)) throw new Error(`${date} is not a trading day`);
  const open = etToUtc(date, 9, 30);
  const from = lastClose(new Date(open.getTime() - 60_000));
  const gradeAt = etToUtc(date, 9, 45);

  const scratch = await openDb("pglite:memory");
  await scratch.migrate();

  // Copy what the pipeline reads: registry, sources, prices for the window, and graded history for analogs.
  const window = await source.db.select().from(headlines).where(and(gte(headlines.receivedAt, from), lt(headlines.receivedAt, open))).orderBy(asc(headlines.receivedAt));
  await copy(tokens, await source.db.select().from(tokens));
  await copy(sources, await source.db.select().from(sources));
  await copy(priceBars1m, await source.db.select().from(priceBars1m).where(and(gte(priceBars1m.ts, new Date(from.getTime() - 86_400_000)), lte(priceBars1m.ts, gradeAt))));
  const history = await source.db.select().from(baskets).where(and(eq(baskets.status, "graded"), lt(baskets.publishedAt, from)));
  for (const b of history) {
    await copy(events, await source.db.select().from(events).where(eq(events.id, b.eventId)));
    await copy(headlines, await source.db.select().from(headlines).where(eq(headlines.eventId, b.eventId)));
    await copy(baskets, [b]);
    await copy(grades, await source.db.select().from(grades).where(eq(grades.basketId, b.id)));
  }
  for (const b of history) await copy(basketLegs, await source.db.select().from(basketLegs).where(eq(basketLegs.basketId, b.id)));

  const clock = { now: from };
  const prices = new MemoryPriceCache();
  const bus = new InMemoryBus({ backoffMs: 0 });
  const offline = opts.offline || !process.env.ANTHROPIC_API_KEY;
  const deps: Deps = {
    db: scratch.db,
    bus,
    embedder: process.env.VOYAGE_API_KEY ? new VoyageEmbedder(process.env.VOYAGE_API_KEY, EMBEDDING_DIM) : new HashingEmbedder(EMBEDDING_DIM),
    news: { kind: "replay", fetch: async () => [] } satisfies NewsSource,
    model: offline ? new OfflineDemoModel(loadTaxonomy) : new AnthropicJsonModel(),
    taxonomy: loadTaxonomy,
    fairValue: new FairValueService(scratch.db, prices, () => clock.now),
    quotes: new BarQuotes(scratch.db, () => clock.now),
    registry: { list: async () => [], poolLiquidityUsdg: async () => null },
    prices,
    equityPrints: null,
    config: DEFAULT_CONFIG,
    ledger: new SimulatedLedger(),
    notifiers: [],
    exits: new BarExitPricer(scratch.db),
    appUrl: "replay://",
    now: () => clock.now,
    log: () => {},
  };
  registerPipeline(deps);

  log(`[replay] ${date}: ${window.length} headlines from ${from.toISOString()} (${offline ? "offline stand-in" : "Claude"})`);
  for (const h of window) {
    clock.now = h.receivedAt;
    await primePrices();
    await scratch.db.insert(headlines).values({ ...h, embedding: null, eventId: null });
    await bus.publish(
      makeEvent(
        "headline.ingested",
        { headline_id: h.id, source_id: h.sourceId, title: h.title, summary: h.summary, url: h.url, lang: h.lang, received_at: h.receivedAt.toISOString() },
        { producer: "replay", correlation_id: h.id, now: h.receivedAt },
      ),
    );
    await bus.idle();
  }

  clock.now = gradeAt;
  const summary = await gradeDay(deps, date);
  const rows = await scratch.db.select().from(baskets).where(gte(baskets.createdAt, from));
  const gradeRows = await scratch.db.select().from(grades);
  const cats = await scratch.db.select({ id: events.id, category: events.category }).from(events);
  const score: ScoreRow[] = rows
    .filter((b) => b.status === "graded" || b.status === "void")
    .map((b) => {
      const g = gradeRows.find((x) => x.basketId === b.id);
      return {
        basket_id: b.id,
        category: cats.find((c) => c.id === b.eventId)?.category ?? null,
        confidence: b.confidence,
        published_at: b.publishedAt?.toISOString() ?? "",
        status: b.status as "graded" | "void",
        void_reason: b.voidReason,
        ret_pct: g?.retPct ?? null,
        vs_spy_pct: g?.vsSpyPct ?? null,
        hit: g?.hit ?? null,
      };
    });

  const label = opts.label ?? `${TRIAGE_PROMPT_VERSION}+${MAP_PROMPT_VERSION}${offline ? "-offline" : ""}`;
  const report = {
    date,
    label,
    prompt_versions: { triage: TRIAGE_PROMPT_VERSION, map: MAP_PROMPT_VERSION },
    headlines: window.length,
    baskets: rows.map((b) => ({ id: b.id, status: b.status, void_reason: b.voidReason, thesis: b.thesis, confidence: b.confidence })),
    grade: summary,
    scorecard: computeScorecard(score),
    dead_letters: bus.deadLetters.map((d) => ({ group: d.group, type: d.event.type, error: d.error })),
  };
  await scratch.close();
  return { report, score };

  async function copy<T extends { $inferInsert: unknown }>(table: T, rows: unknown[]) {
    if (rows.length) await scratch.db.insert(table as never).values(rows as never).onConflictDoNothing();
  }

  async function primePrices() {
    for (const t of await scratch.db.selectDistinct({ symbol: priceBars1m.symbol }).from(priceBars1m)) {
      const [bar] = await scratch.db
        .select()
        .from(priceBars1m)
        .where(and(eq(priceBars1m.symbol, t.symbol), lte(priceBars1m.ts, clock.now)))
        .orderBy(desc(priceBars1m.ts))
        .limit(1);
      if (bar) await prices.set(t.symbol, { px: bar.c, src: bar.source, ts: bar.ts.toISOString() });
    }
  }
}
