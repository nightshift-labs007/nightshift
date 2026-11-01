import type { BasketAlert } from "@nightshift-signals/adapters";
import { translateBasket } from "@nightshift-signals/ai";
import { basketHash } from "@nightshift-signals/chain";
import { DELIVERY_CHANNELS, makeEvent, type DeliveryChannel, type Envelope } from "@nightshift-signals/core";
import { and, asc, baskets, commits, deliveries, eq, events, grades, headlines } from "@nightshift-signals/db";
import type { Deps } from "../deps";
import { loadBasket } from "./commit";

export const PUBLISHER = "publisher";
const MIN_CALIBRATION_SAMPLES = 20;
const TRANSLATE_BUDGET_MS = 3000;

/**
 * Refuses to fan out a basket without a commit whose hash matches the basket. Every channel is sent
 * at once; there is no code path that reaches a subset of users first.
 */
export async function onBasketCommitted(deps: Deps, e: Envelope<"basket.committed">): Promise<void> {
  const loaded = await loadBasket(deps, e.payload.basket_id);
  if (!loaded || loaded.row.status !== "draft") return;
  const { row, basket } = loaded;

  const [commit] = await deps.db.select().from(commits).where(eq(commits.basketId, row.id));
  const hash = basketHash(basket);
  if (!commit?.txHash || commit.hash !== hash || row.canonicalHash !== hash) {
    deps.log(`[publisher] REFUSED ${row.id}: no matching commit`, { commit: commit?.hash, stored: row.canonicalHash, computed: hash });
    return;
  }

  // Translations are not hashed, so they are added now; best effort within a tight budget.
  const i18n = await Promise.race([
    translateBasket(deps.model, basket.thesis, basket.why_chain).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), TRANSLATE_BUDGET_MS)),
  ]);
  const now = deps.now();
  const calibrated = await calibratedConfidence(deps, basket.confidence);
  const claimed = await deps.db
    .update(baskets)
    .set({ status: "published", publishedAt: now, confidenceCalibrated: calibrated, thesisI18n: i18n?.thesis ?? {}, whyChainI18n: i18n?.why_chain ?? {} })
    .where(and(eq(baskets.id, row.id), eq(baskets.status, "draft")))
    .returning({ id: baskets.id });
  if (claimed.length === 0) return;

  const [ev] = await deps.db.select({ title: events.title, severity: events.severity, category: events.category }).from(events).where(eq(events.id, row.eventId));
  const [first] = await deps.db
    .select({ receivedAt: headlines.receivedAt })
    .from(headlines)
    .where(eq(headlines.eventId, row.eventId))
    .orderBy(asc(headlines.receivedAt))
    .limit(1);
  const alert: BasketAlert = {
    basket_id: row.id,
    url: `${deps.appUrl}/b/${row.id}`,
    headline: ev?.title ?? "",
    thesis: basket.thesis,
    thesis_i18n: i18n?.thesis ?? {},
    severity: ev?.severity ?? 0,
    category: ev?.category ?? null,
    legs: basket.legs.map((l) => ({ ticker: l.underlying_ticker, weight: l.weight })),
    confidence: basket.confidence,
    canonical_hash: hash,
    commit_tx: commit.txHash,
    commit_pending: commit.status === "pending",
    simulated: commit.chainId === 0,
  };

  // All channels at once. The WebSocket fan-out happens in the API on basket.published, emitted below.
  const results = await Promise.allSettled(deps.notifiers.map((n) => n.publishBasket(alert)));
  const sentAt = deps.now();
  const latency = first ? sentAt.getTime() - first.receivedAt.getTime() : 0;
  const channels: DeliveryChannel[] = ["ws"];
  results.forEach((r, i) => {
    const n = deps.notifiers[i]!;
    if (r.status === "fulfilled") channels.push(n.channel);
    else deps.log(`[publisher] ${n.channel} failed for ${row.id}`, { error: String(r.reason) });
  });
  await deps.db.insert(deliveries).values(
    channels.filter((c) => DELIVERY_CHANNELS.includes(c)).map((channel) => ({ basketId: row.id, channel, sentAt, latencyMs: latency })),
  );

  await deps.bus.publish(
    makeEvent(
      "basket.published",
      { basket_id: row.id, event_id: row.eventId, channels, sent_at: sentAt.toISOString() },
      { producer: PUBLISHER, correlation_id: row.eventId, now: sentAt },
    ),
  );
}

/** Past hit rate of baskets in the same confidence bucket, once there is enough history. */
async function calibratedConfidence(deps: Deps, confidence: number): Promise<number | null> {
  const lo = Math.floor(confidence * 10) / 10;
  const rows = await deps.db
    .select({ hit: grades.hit, confidence: baskets.confidence })
    .from(grades)
    .innerJoin(baskets, eq(grades.basketId, baskets.id));
  const peers = rows.filter((r) => r.confidence >= lo && r.confidence < lo + 0.1);
  if (peers.length < MIN_CALIBRATION_SAMPLES) return null;
  return Math.round((peers.filter((r) => r.hit).length / peers.length) * 1000) / 1000;
}
