import { MAX_LEG_WEIGHT, MAX_LEGS, MIN_LEGS, normalizeWeights, THESIS_MAX, WHY_STEP_MAX, type Category } from "@nightshift-signals/core";
import type { Taxonomy } from "@nightshift-signals/core/taxonomy";
import type { JsonModel, JsonRequest } from "./model";
import { mapSystem, MAP_PROMPT_VERSION } from "./prompts";
import type { AiCallLog } from "./triage";

export const MAP_MODEL = "claude-sonnet-5-5";
const WEIGHT_TOLERANCE = 0.01;
const PRICE_TARGET = /\$\s?\d|\bprice target\b|\btarget (price|of)\b/i;

export interface EligibleToken {
  underlying_ticker: string;
  name: string;
  /** Live token price vs fair value, when known. Positive = token trades rich. */
  fv_gap_bps: number | null;
  fv_frozen: boolean;
}

export interface Analog {
  title: string;
  occurred_at: string;
  legs: string[];
  ret_pct: string;
  vs_spy_pct: string;
}

export interface MapInput {
  category: Category;
  severity: number;
  headlines: { title: string; summary: string | null }[];
  eligible: EligibleToken[];
  analogs: Analog[];
}

export interface Proposal {
  thesis: string;
  /** Explanatory; an invalid chain is dropped, never a reason to reject the basket. */
  why_chain: string[];
  legs: { underlying_ticker: string; weight: number }[];
  confidence: number;
}

export type MapResult =
  | { kind: "proposal"; proposal: Proposal; model: string; promptVersion: string }
  | { kind: "skip"; reason: string }
  | { kind: "dropped"; reason: string };

/** The ticker enum is built per request from the eligible registry, so the model cannot name an untradeable token. */
export function mapSchema(tickers: string[]) {
  return {
    type: "object",
    properties: {
      skip: { type: "boolean" },
      skip_reason: { type: "string" },
      thesis: { type: "string" },
      cited_text: { type: "string" },
      why_chain: { type: "array", items: { type: "string" } },
      legs: {
        type: "array",
        items: {
          type: "object",
          properties: { underlying_ticker: { type: "string", enum: tickers }, weight: { type: "number" } },
          required: ["underlying_ticker", "weight"],
          additionalProperties: false,
        },
      },
      confidence: { type: "number" },
    },
    required: ["skip", "skip_reason", "thesis", "cited_text", "why_chain", "legs", "confidence"],
    additionalProperties: false,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Models propose, rules decide. Returns a clean proposal or the list of broken rules. */
export function checkProposal(raw: unknown, input: MapInput): { proposal: Proposal } | { errors: string[] } {
  const r = raw as {
    thesis?: unknown;
    cited_text?: unknown;
    why_chain?: unknown;
    legs?: { underlying_ticker?: unknown; weight?: unknown }[];
    confidence?: unknown;
  } | null;
  if (!r || !Array.isArray(r.legs)) return { errors: ["output is not an object with legs"] };
  const errors: string[] = [];
  const eligible = new Set(input.eligible.map((t) => t.underlying_ticker));

  const thesis = typeof r.thesis === "string" ? r.thesis.trim() : "";
  if (!thesis || thesis.length > THESIS_MAX) errors.push(`thesis must be 1-${THESIS_MAX} characters`);
  if (PRICE_TARGET.test(thesis)) errors.push("thesis must not contain price targets");

  const cited = typeof r.cited_text === "string" ? norm(r.cited_text) : "";
  const sources = input.headlines.map((h) => norm(`${h.title} ${h.summary ?? ""}`));
  if (cited.length < 3 || !sources.some((s) => s.includes(cited))) errors.push("cited_text must be an exact phrase from a headline");

  const legs = r.legs.map((l) => ({ underlying_ticker: String(l.underlying_ticker), weight: Number(l.weight) }));
  if (legs.length < MIN_LEGS || legs.length > MAX_LEGS) errors.push(`basket needs ${MIN_LEGS}-${MAX_LEGS} legs`);
  if (new Set(legs.map((l) => l.underlying_ticker)).size !== legs.length) errors.push("duplicate tickers");
  for (const l of legs) {
    if (!eligible.has(l.underlying_ticker)) errors.push(`${l.underlying_ticker} is not eligible`);
    if (!(l.weight > 0) || l.weight > MAX_LEG_WEIGHT + 1e-9) errors.push(`${l.underlying_ticker} weight must be in (0, ${MAX_LEG_WEIGHT}]`);
  }
  const sum = legs.reduce((s, l) => s + l.weight, 0);
  if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) errors.push(`weights sum to ${sum.toFixed(3)}, not 1`);

  const confidence = Number(r.confidence);
  if (!(confidence >= 0 && confidence <= 1)) errors.push("confidence must be in [0, 1]");

  if (errors.length) return { errors };
  return { proposal: { thesis, why_chain: whyChain(r.why_chain), legs: normalizeWeights(legs), confidence } };
}

export function whyChain(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const steps = raw.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  return steps.length >= 2 && steps.length <= 4 && steps.every((s) => s.length <= WHY_STEP_MAX) ? steps : [];
}

function userMessage(input: MapInput): string {
  const tokens = input.eligible
    .map((t) => {
      const gap = t.fv_gap_bps === null ? "fair value unknown" : `fair-value gap ${t.fv_gap_bps > 0 ? "+" : ""}${t.fv_gap_bps} bps${t.fv_frozen ? " (frozen, futures closed)" : ""}`;
      return `- ${t.underlying_ticker} (${t.name}): ${gap}`;
    })
    .join("\n");
  const analogs = input.analogs.length
    ? input.analogs
        .map((a) => `- ${a.occurred_at.slice(0, 10)} "${a.title}": ${a.legs.join("/")} returned ${a.ret_pct}%, ${a.vs_spy_pct}% vs SPY`)
        .join("\n")
    : "none yet";
  return `Category: ${input.category}. Severity: ${input.severity}/5.

Headlines:
${input.headlines.map((h, i) => `${i + 1}. ${h.title}${h.summary ? `\n   ${h.summary}` : ""}`).join("\n")}

Eligible tokens:
${tokens}

Closest past events and their graded outcomes:
${analogs}`;
}

/** One retry with the broken rules fed back, then drop. */
export async function proposeBasket(
  model: JsonModel,
  taxonomy: Taxonomy,
  input: MapInput,
  log: AiCallLog = () => {},
): Promise<MapResult> {
  const request: JsonRequest = {
    model: MAP_MODEL,
    system: mapSystem(taxonomy),
    user: userMessage(input),
    schema: mapSchema(input.eligible.map((t) => t.underlying_ticker)),
    effort: "low",
    maxTokens: 4000,
  };

  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const req = attempt === 0 ? request : { ...request, user: `${request.user}\n\nYour previous answer broke these rules: ${errors.join("; ")}. Answer again.` };
    const response = await model.complete(req);
    if (response.stopReason === "refusal") {
      await log({ kind: "map", promptVersion: MAP_PROMPT_VERSION, request: req, response, error: "refusal" });
      return { kind: "dropped", reason: "refusal" };
    }
    const raw = response.output as { skip?: boolean; skip_reason?: string } | null;
    if (raw?.skip) {
      await log({ kind: "map", promptVersion: MAP_PROMPT_VERSION, request: req, response, error: null });
      return { kind: "skip", reason: raw.skip_reason || "model skipped" };
    }
    const checked = checkProposal(raw, input);
    errors = "errors" in checked ? checked.errors : [];
    await log({ kind: "map", promptVersion: MAP_PROMPT_VERSION, request: req, response, error: errors.join("; ") || null });
    if ("proposal" in checked) return { kind: "proposal", proposal: checked.proposal, model: response.model, promptVersion: MAP_PROMPT_VERSION };
  }
  return { kind: "dropped", reason: errors.join("; ") };
}
