import type { JsonModel } from "./model";
import { TRIAGE_MODEL } from "./triage";

export const TRANSLATE_PROMPT_VERSION = "translate-v2";
export const THESIS_LANGS = ["hi", "es"] as const;

const SYSTEM = `Translate a market thesis and its short causal steps for retail traders. Keep tickers, numbers and meaning exactly; no additions, no advice language. Plain, natural wording a reader on a phone understands. hi = Hindi (Devanagari), es = Spanish (neutral Latin American). Return the same number of steps, in order.`;

const Entry = {
  type: "object",
  properties: { thesis: { type: "string" }, why_chain: { type: "array", items: { type: "string" } } },
  required: ["thesis", "why_chain"],
  additionalProperties: false,
};
const SCHEMA = { type: "object", properties: Object.fromEntries(THESIS_LANGS.map((l) => [l, Entry])), required: [...THESIS_LANGS], additionalProperties: false };

export interface Translations {
  thesis: Record<string, string>;
  why_chain: Record<string, string[]>;
}

/** Translations are not part of the committed hash, so they can be added at publish. Null if unavailable. */
export async function translateBasket(model: JsonModel, thesis: string, chain: string[]): Promise<Translations | null> {
  const res = await model.complete({ model: TRIAGE_MODEL, system: SYSTEM, user: JSON.stringify({ thesis, why_chain: chain }), schema: SCHEMA, effort: "low", maxTokens: 2000 });
  const out = res.output as Record<string, { thesis?: unknown; why_chain?: unknown }> | null;
  if (!out) return null;
  const t: Translations = { thesis: {}, why_chain: {} };
  for (const l of THESIS_LANGS) {
    const e = out[l];
    if (typeof e?.thesis === "string" && e.thesis && e.thesis.length <= 480) t.thesis[l] = e.thesis;
    const steps = e?.why_chain;
    if (Array.isArray(steps) && steps.length === chain.length && steps.every((s) => typeof s === "string" && s.length <= 120)) t.why_chain[l] = steps as string[];
  }
  return Object.keys(t.thesis).length ? t : null;
}
