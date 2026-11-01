import type { Analog } from "@nightshift-signals/ai";
import { basketLegs, baskets, events, grades, headlines, and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "@nightshift-signals/db";
import type { Deps } from "./deps";

export const ANALOG_COUNT = 5;

/** The closest past events (by lead-headline embedding) that have a graded basket, with their real outcomes. */
export async function findAnalogs(deps: Deps, eventId: string): Promise<{ analogs: Analog[]; ids: string[] }> {
  const [lead] = await deps.db
    .select({ embedding: headlines.embedding })
    .from(headlines)
    .where(and(eq(headlines.eventId, eventId), isNotNull(headlines.embedding)))
    .orderBy(asc(headlines.receivedAt))
    .limit(1);
  if (!lead?.embedding) return { analogs: [], ids: [] };

  const distance = sql<number>`${headlines.embedding} <=> ${JSON.stringify(lead.embedding)}::vector`;
  const rows = await deps.db
    .select({
      eventId: events.id,
      title: events.title,
      firstSeenAt: events.firstSeenAt,
      basketId: baskets.id,
      retPct: grades.retPct,
      vsSpyPct: grades.vsSpyPct,
      distance,
    })
    .from(headlines)
    .innerJoin(events, eq(headlines.eventId, events.id))
    .innerJoin(baskets, eq(baskets.eventId, events.id))
    .innerJoin(grades, eq(grades.basketId, baskets.id))
    .where(and(ne(events.id, eventId), isNotNull(headlines.embedding)))
    .orderBy(distance)
    .limit(ANALOG_COUNT * 4);

  const picked = rows.filter((r, i) => rows.findIndex((x) => x.eventId === r.eventId) === i).slice(0, ANALOG_COUNT);
  if (picked.length === 0) return { analogs: [], ids: [] };

  const legs = await deps.db
    .select({ basketId: basketLegs.basketId, ticker: basketLegs.underlyingTicker })
    .from(basketLegs)
    .where(inArray(basketLegs.basketId, picked.map((p) => p.basketId)))
    .orderBy(basketLegs.position);

  const pct = (x: string) => (Number(x) * 100).toFixed(2);
  return {
    ids: picked.map((p) => p.eventId),
    analogs: picked.map((p) => ({
      title: p.title,
      occurred_at: p.firstSeenAt.toISOString(),
      legs: legs.filter((l) => l.basketId === p.basketId).map((l) => l.ticker),
      ret_pct: pct(p.retPct),
      vs_spy_pct: pct(p.vsSpyPct),
    })),
  };
}
