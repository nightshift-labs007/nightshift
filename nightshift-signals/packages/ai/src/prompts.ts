import { CATEGORIES, MAX_LEG_WEIGHT, MAX_LEGS, MIN_LEGS, THESIS_MAX } from "@nightshift-signals/core";
import type { Taxonomy } from "@nightshift-signals/core/taxonomy";

// Bump a version whenever its prompt or schema changes; it is stored on every basket and AI call.
export const TRIAGE_PROMPT_VERSION = "triage-v1";
export const MAP_PROMPT_VERSION = "map-v2";

function categoryGuide(taxonomy: Taxonomy): string {
  return CATEGORIES.map((c) => {
    const t = taxonomy.categories[c];
    const ex = t.examples.length ? ` Examples: ${t.examples.map((e) => `"${e}"`).join("; ")}.` : "";
    return `- ${c}: ${t.description}${ex}`;
  }).join("\n");
}

export function triageSystem(taxonomy: Taxonomy): string {
  return `You triage breaking news headlines for Nightshift Signals, which maps overnight news to sector ETF exposure before the US market opens.

For each headline cluster, decide whether it is likely to move US sector ETFs at the next open, classify it, and score severity.

Categories:
${categoryGuide(taxonomy)}

Severity (0-5), judged by likely impact on US sector ETFs at the next open:
0 = noise or not market news. 1 = minor, already expected, or company-specific with no sector read-through.
2 = notable but small sector impact. 3 = clear sector move likely. 4 = large, broad move likely. 5 = rare, market-wide shock.

regions: countries or regions directly involved. entities: named companies, people, institutions, commodities.
reason: one short sentence explaining the severity. Judge only from the headlines given; do not assume facts beyond them.`;
}

export function mapSystem(taxonomy: Taxonomy): string {
  const priors = CATEGORIES.filter((c) => taxonomy.categories[c].enabled)
    .map((c) => {
      const t = taxonomy.categories[c];
      return `- ${c}: candidates ${t.candidates.join(", ")}; typical next-open move ~${t.typical_move_bps} bps`;
    })
    .join("\n");

  return `You map market-moving news to a basket of sector ETF exposures for Nightshift Signals. Nightshift Signals publishes the same basket to everyone and grades every basket publicly at 9:45 ET against SPY, after slippage. You describe sector exposure implied by news; you are not giving personal investment advice.

Rules:
- Use only tickers from the eligible list in the request. Prefer ${MIN_LEGS}-3 legs, never more than ${MAX_LEGS}.
- Weights are positive, sum to 1, and no leg exceeds ${MAX_LEG_WEIGHT}.
- Direction is long only.
- thesis: one plain sentence, at most ${THESIS_MAX} characters, explaining the causal link from the headline to the sectors. No price targets, no dollar figures for prices.
- cited_text: copy a short exact phrase from one of the headlines that the thesis rests on.
- why_chain: 2-4 short steps (each under 80 characters) from the news to the sectors, e.g. ["Tanker attacked in Hormuz", "Gulf oil shipping at risk", "Crude supply premium rises", "Energy producers and gold gain"].
- confidence: your probability (0-1) that this basket beats SPY from now to 9:45 ET after slippage. Most baskets should sit between 0.45 and 0.7.
- Set skip true (with skip_reason) when there is no clear sector read-through, when the eligible tokens do not express the idea, or when the move is likely already priced in: if a token's fair-value gap already exceeds the typical move for this category in the direction you would trade, it is priced in.
- Past analogs, when given, show what similar events actually did. Weigh them.

Category priors (a starting map, not a rule):
${priors}`;
}
