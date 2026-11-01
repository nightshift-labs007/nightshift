import { makeEvent, newId } from "@nightshift-signals/core";
import { headlines, sources, eq } from "@nightshift-signals/db";
import type { Deps } from "../deps";

export const INGEST = "ingest";

/** Polls one source; stores new headlines (idempotent on source + item id) and emits headline.ingested. */
export async function pollSource(deps: Deps, source: typeof sources.$inferSelect): Promise<number> {
  const items = await deps.news.fetch(source.url);
  let fresh = 0;
  for (const item of items) {
    const receivedAt = deps.now();
    const id = newId("headline", receivedAt.getTime());
    const inserted = await deps.db
      .insert(headlines)
      .values({
        id,
        sourceId: source.id,
        sourceItemId: item.source_item_id,
        url: item.url,
        title: item.title,
        summary: item.summary,
        lang: item.lang,
        publishedAt: item.published_at,
        receivedAt,
      })
      .onConflictDoNothing()
      .returning({ id: headlines.id });
    if (inserted.length === 0) continue;
    fresh++;
    await deps.bus.publish(
      makeEvent(
        "headline.ingested",
        {
          headline_id: id,
          source_id: source.id,
          title: item.title,
          summary: item.summary,
          url: item.url,
          lang: item.lang,
          received_at: receivedAt.toISOString(),
        },
        { producer: INGEST, correlation_id: id, now: receivedAt },
      ),
    );
  }
  return fresh;
}

export async function pollAllSources(deps: Deps): Promise<void> {
  const active = await deps.db.select().from(sources).where(eq(sources.active, true));
  await Promise.all(
    active.map(async (s) => {
      try {
        const n = await pollSource(deps, s);
        if (n > 0) deps.log(`[ingest] ${s.name}: ${n} new`);
      } catch (e) {
        deps.log(`[ingest] ${s.name} failed`, { error: String(e) });
      }
    }),
  );
}
