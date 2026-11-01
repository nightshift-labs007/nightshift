import { CATEGORIES, MAX_SEVERITY, Triage } from "@nightshift-signals/core";
import type { Taxonomy } from "@nightshift-signals/core/taxonomy";
import type { JsonModel, JsonRequest, JsonResponse } from "./model";
import { triageSystem, TRIAGE_PROMPT_VERSION } from "./prompts";

export const TRIAGE_MODEL = "claude-haiku-5-5";

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    is_market_moving: { type: "boolean" },
    category: { type: "string", enum: [...CATEGORIES] },
    regions: { type: "array", items: { type: "string" } },
    severity: { type: "integer", enum: Array.from({ length: MAX_SEVERITY + 1 }, (_, i) => i) },
    entities: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
  required: ["is_market_moving", "category", "regions", "severity", "entities", "reason"],
  additionalProperties: false,
} as const;

export type AiCallLog = (entry: {
  kind: "triage" | "map";
  promptVersion: string;
  request: JsonRequest;
  response: JsonResponse | null;
  error: string | null;
}) => Promise<void> | void;

export interface TriageInput {
  headlines: { title: string; summary: string | null; source: string }[];
}

/** One retry on invalid output, then throws (the bus dead-letters it). */
export async function triageHeadlines(
  model: JsonModel,
  taxonomy: Taxonomy,
  input: TriageInput,
  log: AiCallLog = () => {},
): Promise<Triage> {
  const request: JsonRequest = {
    model: TRIAGE_MODEL,
    system: triageSystem(taxonomy),
    user: input.headlines
      .map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.summary ? `\n   ${h.summary}` : ""}`)
      .join("\n"),
    schema: TRIAGE_SCHEMA,
    effort: "low",
    maxTokens: 2000,
  };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await model.complete(request);
    const raw = response.output as Record<string, unknown> | null;
    const parsed = Triage.safeParse(raw && { ...raw, reason: String(raw.reason ?? "").slice(0, 160) });
    lastError = response.stopReason === "refusal" ? "refusal" : parsed.success ? "" : parsed.error.message;
    await log({ kind: "triage", promptVersion: TRIAGE_PROMPT_VERSION, request, response, error: lastError || null });
    if (parsed.success) return parsed.data;
  }
  throw new Error(`triage failed: ${lastError}`);
}
