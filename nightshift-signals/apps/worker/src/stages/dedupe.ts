import { makeEvent, newId, type Envelope } from "@nightshift-signals/core";
import { events, headlines, and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "@nightshift-signals/db";
import type { Deps } from "../deps";

export const DEDUPE = "dedupe";
/** Cosine similarity above this, within the window, joins an existing cluster. */
export const CLUSTER_SIMILARITY = 0.9;
export const CLUSTER_WINDOW_MS = 30 * 60 * 1000;

export const toVector = (v: number[]) => sql`${JSON.stringify(v)}::vector`;

export async function onHeadlineIngested(deps: Deps, e: Envelope<"headline.ingested">): Promise<void> {
  const p = e.payload;
  const [embedding] = await deps.embedder.embed([[p.title, p.summary].filter(Boolean).join("\n")]);
  if (!embedding) throw new Error("embedder returned nothing");
  await deps.db.update(headlines).set({ embedding }).where(eq(headlines.id, p.headline_id));

  const receivedAt = new Date(p.received_at);
  const distance = sql<number>`${headlines.embedding} <=> ${toVector(embedding)}`;
  const [nearest] = await deps.db
    .select({ eventId: headlines.eventId, distance })
    .from(headlines)
    .where(
      and(
        ne(headlines.id, p.headline_id),
        isNotNull(headlines.eventId),
        gt(headlines.receivedAt, new Date(receivedAt.getTime() - CLUSTER_WINDOW_MS)),
      ),
    )
    .orderBy(distance)
    .limit(1);

  const joins = nearest?.eventId && 1 - Number(nearest.distance) > CLUSTER_SIMILARITY;
  const eventId = joins ? nearest.eventId! : newId("event", receivedAt.getTime());

  if (!joins) {
    await deps.db.insert(events).values({ id: eventId, title: p.title, firstSeenAt: receivedAt, sourcesN: 1 });
  }
  await deps.db.update(headlines).set({ eventId }).where(eq(headlines.id, p.headline_id));

  const members = await deps.db
    .select({ id: headlines.id, sourceId: headlines.sourceId })
    .from(headlines)
    .where(eq(headlines.eventId, eventId))
    .orderBy(headlines.receivedAt);
  const sourcesN = new Set(members.map((m) => m.sourceId)).size;
  if (joins) await deps.db.update(events).set({ sourcesN }).where(eq(events.id, eventId));

  await deps.bus.publish(
    makeEvent(
      "event.clustered",
      {
        event_id: eventId,
        headline_id: p.headline_id,
        headline_ids: members.map((m) => m.id),
        sources_n: sourcesN,
        is_new: !joins,
      },
      { producer: DEDUPE, correlation_id: eventId, now: deps.now() },
    ),
  );
}
