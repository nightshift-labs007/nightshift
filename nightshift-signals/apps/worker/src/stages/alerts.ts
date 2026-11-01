import { matchesTrigger, type Envelope } from "@nightshift-signals/core";
import { eq, events, triggers } from "@nightshift-signals/db";
import type { Deps } from "../deps";
import { PushNotifier } from "../push";

export const ALERTS = "alerts";

function pushOf(deps: Deps): PushNotifier | null {
  return (deps.notifiers.find((n) => n instanceof PushNotifier) as PushNotifier | undefined) ?? null;
}

/** Plain-English triggers that asked for push. (The API delivers the WebSocket copy.) */
export async function onTriagedForTriggers(deps: Deps, e: Envelope<"event.triaged">): Promise<void> {
  const push = pushOf(deps);
  if (!push) return;
  const active = await deps.db.select().from(triggers).where(eq(triggers.active, true));
  const matched = active.filter((t) => t.channels.includes("push") && matchesTrigger(t.compiledRule, e.payload));
  if (!matched.length) return;
  const [ev] = await deps.db.select({ title: events.title }).from(events).where(eq(events.id, e.payload.event_id));
  await Promise.all(matched.map((t) => push.publishTrigger(t.userId, { nl_text: t.nlText, title: ev?.title ?? "Nightshift Signals alert", url: `${deps.appUrl}/e/${e.payload.event_id}` })));
}

export async function onDrift(deps: Deps, e: Envelope<"alert.drift">): Promise<void> {
  if (e.payload.frozen) return;
  await pushOf(deps)?.publishDrift(e.payload);
}
