import type { Payload } from "./events";
import type { TriggerRule } from "./schemas/user";

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

/** Does a triaged event satisfy a compiled plain-English trigger? Empty lists mean "any". */
export function matchesTrigger(rule: TriggerRule, e: Payload<"event.triaged">): boolean {
  if (!e.is_market_moving || e.severity < rule.min_severity) return false;
  if (rule.categories.length && !rule.categories.includes(e.category)) return false;
  const ents = lower(e.entities);
  if (rule.entities.length && !lower(rule.entities).some((x) => ents.some((y) => y.includes(x)))) return false;
  const regs = lower(e.regions);
  if (rule.regions.length && !lower(rule.regions).some((x) => regs.includes(x))) return false;
  return true;
}
