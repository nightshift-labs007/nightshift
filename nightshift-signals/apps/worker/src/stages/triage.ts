import { triageHeadlines } from "@nightshift-signals/ai";
import { makeEvent, MAX_SEVERITY, type Envelope } from "@nightshift-signals/core";
import { events, headlines, sources, eq } from "@nightshift-signals/db";
import { aiCallLogger } from "../ai-log";
import type { Deps } from "../deps";

export const TRIAGE = "triage";
/** Independent sources needed for the corroboration boost. */
export const CORROBORATION_SOURCES = 3;

export async function clusterHeadlines(deps: Deps, eventId: string) {
  return deps.db
    .select({ title: headlines.title, summary: headlines.summary, source: sources.name })
    .from(headlines)
    .innerJoin(sources, eq(headlines.sourceId, sources.id))
    .where(eq(headlines.eventId, eventId))
    .orderBy(headlines.receivedAt)
    .limit(10);
}

/** Triage once per event; re-emit with a +1 severity boost when the cluster reaches 3 independent sources. */
export async function onEventClustered(deps: Deps, e: Envelope<"event.clustered">): Promise<void> {
  const p = e.payload;
  const [ev] = await deps.db.select().from(events).where(eq(events.id, p.event_id));
  if (!ev) throw new Error(`event ${p.event_id} not found`);
  const corroborated = p.sources_n >= CORROBORATION_SOURCES;

  let triage;
  if (ev.triagedAt === null) {
    const t = await triageHeadlines(
      deps.model,
      deps.taxonomy(),
      { headlines: await clusterHeadlines(deps, p.event_id) },
      aiCallLogger(deps, p.event_id),
    );
    const severity = Math.min(MAX_SEVERITY, t.severity + (corroborated && t.is_market_moving ? 1 : 0));
    triage = { ...t, severity };
    await deps.db
      .update(events)
      .set({
        isMarketMoving: t.is_market_moving,
        category: t.category,
        severity,
        regions: t.regions,
        entities: t.entities,
        reason: t.reason,
        corroborated,
        triagedAt: deps.now(),
      })
      .where(eq(events.id, p.event_id));
  } else if (corroborated && !ev.corroborated && ev.isMarketMoving && ev.category && ev.severity !== null) {
    const severity = Math.min(MAX_SEVERITY, ev.severity + 1);
    await deps.db.update(events).set({ severity, corroborated: true }).where(eq(events.id, p.event_id));
    triage = { is_market_moving: true, category: ev.category, severity, regions: ev.regions, entities: ev.entities };
  } else {
    return;
  }

  await deps.bus.publish(
    makeEvent(
      "event.triaged",
      {
        event_id: p.event_id,
        is_market_moving: triage.is_market_moving,
        category: triage.category,
        severity: triage.severity,
        regions: triage.regions,
        entities: triage.entities,
        corroborated,
      },
      { producer: TRIAGE, correlation_id: p.event_id, now: deps.now() },
    ),
  );
}
