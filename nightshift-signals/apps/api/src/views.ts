import { CATEGORIES, type BasketStatus, type Category, type CsvLeg, type ScoreRow } from "@nightshift-signals/core";
import {
  and, asc, basketLegs, baskets, commits, desc, eq, events, gte, grades, headlines, inArray, isNotNull, lte, rowsToBasket, sources, type Db,
} from "@nightshift-signals/db";

// Only baskets with published_at are ever served: drafts and committed-but-unpublished baskets
// are invisible here, so the API cannot hand anyone a basket before the public feed has it.

export interface BasketSummary {
  id: string;
  thesis: string;
  thesis_i18n: Record<string, string>;
  legs: { ticker: string; weight: number }[];
  confidence: number;
  status: BasketStatus;
  void_reason: string | null;
  published_at: string;
  commit_tx: string | null;
  simulated: boolean;
  grade: { ret_pct: string; vs_spy_pct: string; hit: boolean } | null;
}

export async function basketSummaries(db: Db, ids: string[]): Promise<Map<string, BasketSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ b: baskets, c: commits, g: grades })
    .from(baskets)
    .leftJoin(commits, eq(commits.basketId, baskets.id))
    .leftJoin(grades, eq(grades.basketId, baskets.id))
    .where(and(inArray(baskets.id, ids), isNotNull(baskets.publishedAt)));
  const legs = await db.select().from(basketLegs).where(inArray(basketLegs.basketId, ids)).orderBy(asc(basketLegs.position));
  return new Map(
    rows.map(({ b, c, g }) => [
      b.id,
      {
        id: b.id,
        thesis: b.thesis,
        thesis_i18n: b.thesisI18n,
        legs: legs.filter((l) => l.basketId === b.id).map((l) => ({ ticker: l.underlyingTicker, weight: Number(l.weight) })),
        confidence: b.confidence,
        status: b.status,
        void_reason: b.voidReason,
        published_at: b.publishedAt!.toISOString(),
        commit_tx: b.commitTx,
        simulated: c?.chainId === 0,
        grade: g ? { ret_pct: g.retPct, vs_spy_pct: g.vsSpyPct, hit: g.hit } : null,
      },
    ]),
  );
}

export interface FeedQuery {
  since?: string;
  minSeverity: number;
  category?: Category;
  region?: string;
  limit: number;
}

export async function feed(db: Db, q: FeedQuery) {
  const conds = [isNotNull(events.triagedAt), gte(events.severity, q.minSeverity)];
  if (q.since) conds.push(gte(events.firstSeenAt, new Date(q.since)));
  if (q.category) conds.push(eq(events.category, q.category));
  const evs = (await db.select().from(events).where(and(...conds)).orderBy(desc(events.firstSeenAt)).limit(q.limit)).filter(
    (e) => !q.region || e.regions.some((r) => r.toLowerCase() === q.region!.toLowerCase()),
  );
  const bs = evs.length
    ? await db.select({ id: baskets.id, eventId: baskets.eventId }).from(baskets).where(and(inArray(baskets.eventId, evs.map((e) => e.id)), isNotNull(baskets.publishedAt)))
    : [];
  const summaries = await basketSummaries(db, bs.map((b) => b.id));
  return evs.map((e) => ({
    event: eventView(e),
    basket: summaries.get(bs.find((b) => b.eventId === e.id)?.id ?? "") ?? null,
  }));
}

export function eventView(e: typeof events.$inferSelect) {
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    severity: e.severity,
    regions: e.regions,
    entities: e.entities,
    reason: e.reason,
    sources_n: e.sourcesN,
    corroborated: e.corroborated,
    first_seen_at: e.firstSeenAt.toISOString(),
    triaged_at: e.triagedAt?.toISOString() ?? null,
  };
}

export async function eventHeadlines(db: Db, eventId: string) {
  const rows = await db
    .select({ title: headlines.title, url: headlines.url, source: sources.name, received_at: headlines.receivedAt })
    .from(headlines)
    .innerJoin(sources, eq(headlines.sourceId, sources.id))
    .where(eq(headlines.eventId, eventId))
    .orderBy(asc(headlines.receivedAt));
  return rows.map((r) => ({ ...r, received_at: r.received_at.toISOString() }));
}

export async function eventDetail(db: Db, id: string) {
  const [e] = await db.select().from(events).where(eq(events.id, id));
  if (!e) return null;
  const bs = await db.select({ id: baskets.id }).from(baskets).where(and(eq(baskets.eventId, id), isNotNull(baskets.publishedAt)));
  return { event: eventView(e), headlines: await eventHeadlines(db, id), baskets: [...(await basketSummaries(db, bs.map((b) => b.id))).values()] };
}

export async function basketDetail(db: Db, id: string) {
  const [row] = await db.select().from(baskets).where(and(eq(baskets.id, id), isNotNull(baskets.publishedAt)));
  if (!row) return null;
  const legs = await db.select().from(basketLegs).where(eq(basketLegs.basketId, id));
  const [e] = await db.select().from(events).where(eq(events.id, row.eventId));
  const [c] = await db.select().from(commits).where(eq(commits.basketId, id));
  const [g] = await db.select().from(grades).where(eq(grades.basketId, id));
  const analogs = row.analogEventIds.length ? await db.select().from(events).where(inArray(events.id, row.analogEventIds)) : [];
  const analogBaskets = analogs.length ? await db.select({ id: baskets.id, eventId: baskets.eventId }).from(baskets).where(inArray(baskets.eventId, analogs.map((a) => a.id))) : [];
  const analogSummaries = await basketSummaries(db, analogBaskets.map((a) => a.id));
  return {
    basket: rowsToBasket(row, legs),
    why_chain_i18n: row.whyChainI18n,
    event: e ? eventView(e) : null,
    headlines: e ? await eventHeadlines(db, e.id) : [],
    commit: c
      ? { hash: c.hash, tx_hash: c.txHash, chain_id: c.chainId, status: c.status, block_number: c.blockNumber, block_time: c.blockTime?.toISOString() ?? null, simulated: c.chainId === 0 }
      : null,
    grade: g
      ? { graded_at: g.gradedAt.toISOString(), legs: g.legs, ret_pct: g.retPct, spy_ret_pct: g.spyRetPct, vs_spy_pct: g.vsSpyPct, spy_entry: g.spyEntry, spy_exit: g.spyExit, hit: g.hit }
      : null,
    analogs: analogs.map((a) => ({ event: eventView(a), basket: analogSummaries.get(analogBaskets.find((x) => x.eventId === a.id)?.id ?? "") ?? null })),
  };
}

export interface ScorecardFilter {
  from?: string;
  to?: string;
  category?: Category;
}

/** Every published basket that has been graded or voided. Nothing is ever filtered out for looking bad. */
export async function scorecardRows(db: Db, f: ScorecardFilter) {
  const conds = [isNotNull(baskets.publishedAt), inArray(baskets.status, ["graded", "void"])];
  if (f.from) conds.push(gte(baskets.publishedAt, new Date(f.from)));
  if (f.to) conds.push(lte(baskets.publishedAt, new Date(f.to)));
  const rows = await db
    .select({ b: baskets, g: grades, category: events.category })
    .from(baskets)
    .innerJoin(events, eq(events.id, baskets.eventId))
    .leftJoin(grades, eq(grades.basketId, baskets.id))
    .where(and(...conds))
    .orderBy(desc(baskets.publishedAt));
  const filtered = f.category ? rows.filter((r) => r.category === f.category) : rows;
  const score: (ScoreRow & { thesis: string; graded_at: string | null })[] = filtered.map(({ b, g, category }) => ({
    basket_id: b.id,
    category,
    confidence: b.confidence,
    published_at: b.publishedAt!.toISOString(),
    status: b.status as "graded" | "void",
    void_reason: b.voidReason,
    ret_pct: g?.retPct ?? null,
    vs_spy_pct: g?.vsSpyPct ?? null,
    hit: g?.hit ?? null,
    thesis: b.thesis,
    graded_at: g?.gradedAt.toISOString() ?? null,
  }));
  return score;
}

export async function csvLegs(db: Db, f: ScorecardFilter): Promise<CsvLeg[]> {
  const rows = await scorecardRows(db, f);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.basket_id);
  const legs = await db.select().from(basketLegs).where(inArray(basketLegs.basketId, ids)).orderBy(asc(basketLegs.position));
  const bs = await db.select({ id: baskets.id, hash: baskets.canonicalHash, tx: baskets.commitTx }).from(baskets).where(inArray(baskets.id, ids));
  const gs = await db.select().from(grades).where(inArray(grades.basketId, ids));
  return rows.flatMap((r) => {
    const g = gs.find((x) => x.basketId === r.basket_id);
    const b = bs.find((x) => x.id === r.basket_id);
    return legs
      .filter((l) => l.basketId === r.basket_id)
      .map((l) => ({
        basket_id: r.basket_id,
        published_at: r.published_at,
        category: r.category ?? "",
        confidence: r.confidence,
        status: r.status,
        void_reason: r.void_reason ?? "",
        canonical_hash: b?.hash ?? "",
        commit_tx: b?.tx ?? "",
        token_symbol: l.tokenSymbol,
        weight: Number(l.weight),
        entry_quote_price: l.entryQuotePrice,
        exit_price: g?.legs.find((x) => x.token_symbol === l.tokenSymbol)?.exit_price ?? "",
        spy_entry: g?.spyEntry ?? "",
        spy_exit: g?.spyExit ?? "",
        ret_pct: g?.retPct ?? "",
        vs_spy_pct: g?.vsSpyPct ?? "",
        hit: g ? String(g.hit) : "",
      }));
  });
}

export const isCategory = (c: unknown): c is Category => CATEGORIES.includes(c as Category);
