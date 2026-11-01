import { proposeBasket } from "@nightshift-signals/ai";
import { makeEvent, MAP_MIN_SEVERITY, newBasketId, type Envelope } from "@nightshift-signals/core";
import { and, desc, eq, events, isNull, tokens } from "@nightshift-signals/db";
import { aiCallLogger } from "../ai-log";
import { findAnalogs } from "../analogs";
import { isCategoryDisabled } from "../market/categories";
import type { Deps } from "../deps";
import { clusterHeadlines } from "./triage";

export const MAPPER = "mapper";
/** Past this, publish the event without a basket rather than a stale basket. */
export const MAP_CUTOFF_MS = 5 * 60 * 1000;

/** One eligible token per underlying (the most liquid). */
export async function eligibleTokens(deps: Deps) {
  const rows = await deps.db.select().from(tokens).where(eq(tokens.eligible, true)).orderBy(desc(tokens.poolLiquidityUsdg));
  return rows.filter((r, i) => rows.findIndex((x) => x.underlyingTicker === r.underlyingTicker) === i);
}

export async function onEventTriaged(deps: Deps, e: Envelope<"event.triaged">): Promise<void> {
  const p = e.payload;
  if (!p.is_market_moving || p.severity < MAP_MIN_SEVERITY) return;

  const [ev] = await deps.db.select().from(events).where(eq(events.id, p.event_id));
  if (!ev) throw new Error(`event ${p.event_id} not found`);
  if (deps.now().getTime() - ev.firstSeenAt.getTime() > MAP_CUTOFF_MS) {
    deps.log(`[mapper] ${p.event_id} past the ${MAP_CUTOFF_MS / 60000}-minute cutoff, no basket`);
    return;
  }

  const taxonomy = deps.taxonomy();
  if (!taxonomy.categories[p.category].enabled || (await isCategoryDisabled(deps, p.category))) return;

  // Claim the event; a re-triage (corroboration boost) must not produce a second basket.
  const claimed = await deps.db
    .update(events)
    .set({ mappedAt: deps.now() })
    .where(and(eq(events.id, p.event_id), isNull(events.mappedAt)))
    .returning({ id: events.id });
  if (claimed.length === 0) return;
  try {
    await mapEvent(deps, p);
  } catch (err) {
    // Release the claim so the bus retry can map it.
    await deps.db.update(events).set({ mappedAt: null }).where(eq(events.id, p.event_id));
    throw err;
  }
}

async function mapEvent(deps: Deps, p: Envelope<"event.triaged">["payload"]) {
  const taxonomy = deps.taxonomy();

  const eligible = await eligibleTokens(deps);
  if (eligible.length < 2) {
    deps.log(`[mapper] only ${eligible.length} eligible tokens, no basket`);
    return;
  }
  const gaps = await deps.fairValue.gaps(eligible.map((t) => t.underlyingTicker));
  const { analogs, ids } = await findAnalogs(deps, p.event_id);

  const result = await proposeBasket(
    deps.model,
    taxonomy,
    {
      category: p.category,
      severity: p.severity,
      headlines: await clusterHeadlines(deps, p.event_id),
      eligible: eligible.map((t) => ({
        underlying_ticker: t.underlyingTicker,
        name: t.name,
        fv_gap_bps: gaps.get(t.underlyingTicker)?.gap_bps ?? null,
        fv_frozen: gaps.get(t.underlyingTicker)?.frozen ?? false,
      })),
      analogs,
    },
    aiCallLogger(deps, p.event_id),
  );

  if (result.kind !== "proposal") {
    deps.log(`[mapper] ${p.event_id} ${result.kind}: ${result.reason}`);
    return;
  }

  const now = deps.now();
  await deps.bus.publish(
    makeEvent(
      "basket.proposed",
      {
        basket_id: newBasketId(now),
        event_id: p.event_id,
        thesis: result.proposal.thesis,
        legs: result.proposal.legs,
        confidence: result.proposal.confidence,
        created_at: now.toISOString(),
        model_version: result.model,
        prompt_version: result.promptVersion,
        analog_event_ids: ids,
        why_chain: result.proposal.why_chain,
      },
      { producer: MAPPER, correlation_id: p.event_id, now },
    ),
  );
}
