import { CATEGORIES, type Category } from "@nightshift-signals/core";
import type { Taxonomy } from "@nightshift-signals/core/taxonomy";
import type { JsonModel, JsonRequest, JsonResponse } from "./model";
import { MAP_MODEL } from "./mapper";

export const OFFLINE_MODEL_VERSION = "offline-demo";

const KEYWORDS: Record<Category, RegExp> = {
  geopolitics_energy: /\b(oil|crude|brent|opec|tanker|hormuz|pipeline|refinery)\b/i,
  conflict_defense: /\b(missile|troops|nato|defen[cs]e|strike|war|invasion)\b/i,
  semis_export: /\b(chip|semiconductor|export (curbs|controls)|nvidia|tsmc)\b/i,
  monetary_policy: /\b(fed|fomc|rate (cut|hike)|powell|waller|treasury yields?)\b/i,
  trade_tariffs: /\b(tariffs?|trade deal|retaliat\w*|duties)\b/i,
  china_macro: /\b(china|pboc|beijing|yuan)\b.*\b(stimulus|growth|gdp|easing)\b|\bstimulus\b.*\bchina\b/i,
  crypto_regulation: /\b(bitcoin|crypto|sec)\b.*\b(etf|approv\w*|regulat\w*|ban)\b/i,
  health_policy: /\b(drug pric\w*|fda|medicare|pharma)\b/i,
  earnings_megacap: /\b(earnings|guidance|beats|misses)\b/i,
  other: /$^/,
};

/**
 * Keyword heuristic standing in for Claude when no API key is configured (`pnpm dev:local`).
 * Not a model; baskets it produces carry model_version "offline-demo" and must never be graded publicly.
 */
export class OfflineDemoModel implements JsonModel {
  constructor(private taxonomy: () => Taxonomy) {}

  async complete(req: JsonRequest): Promise<JsonResponse> {
    const props = (req.schema as { properties?: object }).properties ?? {};
    // The offline stand-in cannot translate; it returns nothing rather than fake translations.
    if ("hi" in props) return { output: null, stopReason: "end_turn", model: OFFLINE_MODEL_VERSION, latencyMs: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const isTrigger = "min_severity" in props;
    return {
      output: isTrigger ? this.trigger(req.user) : req.model === MAP_MODEL ? this.map(req) : this.triage(req.user),
      stopReason: "end_turn",
      model: OFFLINE_MODEL_VERSION,
      latencyMs: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }

  private trigger(text: string) {
    const categories = CATEGORIES.filter((c) => KEYWORDS[c].test(text));
    const sev = Number(text.match(/severity\s*(\d)/i)?.[1] ?? 3);
    return { categories, min_severity: Math.min(5, sev), entities: [], regions: [] };
  }

  private triage(text: string) {
    const category = CATEGORIES.find((c) => KEYWORDS[c].test(text)) ?? "other";
    const hot = category !== "other";
    return { is_market_moving: hot, category, regions: [], entities: [], severity: hot ? 3 + (text.length % 2) : 1, reason: "offline keyword match" };
  }

  private map(req: JsonRequest) {
    const category = (req.user.match(/^Category: (\w+)\./m)?.[1] ?? "other") as Category;
    const eligible = (req.schema as { properties: { legs: { items: { properties: { underlying_ticker: { enum: string[] } } } } } }).properties.legs.items
      .properties.underlying_ticker.enum;
    const picks = this.taxonomy().categories[category].candidates.filter((t) => eligible.includes(t)).slice(0, 3);
    const headline = req.user.match(/^1\. (.+)$/m)?.[1] ?? "";
    if (picks.length < 2) return { skip: true, skip_reason: "no eligible candidates", thesis: "", cited_text: "", why_chain: [], legs: [], confidence: 0 };
    const w = picks.length === 2 ? [0.5, 0.5] : [0.4, 0.35, 0.25];
    return {
      skip: false,
      skip_reason: "",
      thesis: `Offline demo: ${category.replace(/_/g, " ")} news points to ${picks.join(", ")}.`,
      cited_text: headline.split(" ").slice(0, 4).join(" "),
      why_chain: [headline.slice(0, 60), this.taxonomy().categories[category].description.split(",")[0]!.slice(0, 70), `${picks.join(", ")} exposure`],
      legs: picks.map((t, i) => ({ underlying_ticker: t, weight: w[i] })),
      confidence: 0.5,
    };
  }
}
