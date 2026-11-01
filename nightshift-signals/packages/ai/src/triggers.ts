import { CATEGORIES, DELIVERY_CHANNELS, TriggerRule } from "@nightshift-signals/core";
import type { JsonModel } from "./model";
import { TRIAGE_MODEL } from "./triage";

export const TRIGGER_PROMPT_VERSION = "trigger-v1";

export const TRIGGER_SCHEMA = {
  type: "object",
  properties: {
    categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
    min_severity: { type: "integer", enum: [0, 1, 2, 3, 4, 5] },
    entities: { type: "array", items: { type: "string" } },
    regions: { type: "array", items: { type: "string" } },
  },
  required: ["categories", "min_severity", "entities", "regions"],
  additionalProperties: false,
} as const;

export const TRIGGER_SYSTEM = `You compile a Nightshift Signals user's plain-English alert request into a filter over triaged news events.
Categories: ${CATEGORIES.join(", ")}. Severity is 0-5 (3 = clear sector move likely).
Leave a list empty to mean "any". If the user names no severity, use 3. Use entities only for names the user explicitly mentions.`;

/** Plain-English trigger → rule JSON. The user confirms the compiled rule before it is saved. */
export async function compileTrigger(model: JsonModel, text: string): Promise<TriggerRule> {
  const res = await model.complete({ model: TRIAGE_MODEL, system: TRIGGER_SYSTEM, user: text, schema: TRIGGER_SCHEMA, effort: "low", maxTokens: 1000 });
  const parsed = TriggerRule.safeParse(res.output);
  if (!parsed.success) throw new Error("could not compile that trigger; try naming a sector and a severity");
  return parsed.data;
}

export const TRIGGER_CHANNELS = DELIVERY_CHANNELS;
