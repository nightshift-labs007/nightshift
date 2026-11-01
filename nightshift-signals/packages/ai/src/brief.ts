import type { JsonModel } from "./model";
import { TRIAGE_MODEL } from "./triage";

export const BRIEF_PROMPT_VERSION = "brief-v1";
export const BRIEF_MAX_WORDS = 160;

export interface BriefInput {
  date: string;
  hit_rate: number | null;
  graded: { thesis: string; ret_pct: string; vs_spy_pct: string; hit: boolean }[];
  voids: number;
}

const LANG_NAMES: Record<string, string> = { en: "English", hi: "Hindi (Devanagari script)", es: "Spanish (neutral Latin American)" };

const SYSTEM = `You write Nightshift Signals's 60-second spoken morning brief, read aloud at the US open. Report last night's graded baskets honestly: lead with the overall record, name misses as plainly as wins, give each basket's result versus SPY in words a listener understands ("beat SPY by four tenths of a percent"). No advice, no predictions, no hype. Spoken style: short sentences, no lists, no symbols, no tickers spelled as letters unless needed. End with "Information, not advice."`;

const SCHEMA = { type: "object", properties: { script: { type: "string" } }, required: ["script"], additionalProperties: false };

/** Null when the model is unavailable or the output is unusable; callers fall back to the template. */
export async function writeBrief(model: JsonModel, input: BriefInput, lang: string): Promise<string | null> {
  const res = await model.complete({
    model: TRIAGE_MODEL,
    system: SYSTEM,
    user: `Language: ${LANG_NAMES[lang] ?? lang}. At most ${BRIEF_MAX_WORDS} words.\n${JSON.stringify(input)}`,
    schema: SCHEMA,
    effort: "low",
    maxTokens: 2000,
  });
  const script = (res.output as { script?: unknown } | null)?.script;
  return typeof script === "string" && script.trim().length > 40 && script.split(/\s+/).length <= BRIEF_MAX_WORDS * 1.3 ? script.trim() : null;
}

const pct = (f: string) => Math.abs(Number(f) * 100).toFixed(1);

/** Deterministic fallback in each language. Plain and complete; no model involved. */
export function templateBrief(input: BriefInput, lang: string): string {
  const n = input.graded.length;
  const wins = input.graded.filter((g) => g.hit).length;
  const lines = input.graded.slice(0, 5);
  if (lang === "hi") {
    const parts = lines.map((g, i) => `बास्केट ${i + 1}: ${g.hit ? `SPY से ${pct(g.vs_spy_pct)} प्रतिशत बेहतर` : `SPY से ${pct(g.vs_spy_pct)} प्रतिशत पीछे`}।`);
    return [`Nightshift Signals सुबह की रिपोर्ट, ${input.date}।`, n ? `कल रात की ${n} बास्केट में से ${wins} ने SPY को पीछे छोड़ा।` : "कल रात कोई बास्केट ग्रेड नहीं हुई।", ...parts, input.voids ? `${input.voids} बास्केट रद्द हुईं।` : "", "यह जानकारी है, सलाह नहीं।"].filter(Boolean).join(" ");
  }
  if (lang === "es") {
    const parts = lines.map((g, i) => `Canasta ${i + 1}: ${g.hit ? `superó al SPY por ${pct(g.vs_spy_pct)} por ciento` : `quedó ${pct(g.vs_spy_pct)} por ciento detrás del SPY`}.`);
    return [`Informe de la mañana de Nightshift Signals, ${input.date}.`, n ? `De ${n} canastas de anoche, ${wins} superaron al SPY.` : "Anoche no se calificó ninguna canasta.", ...parts, input.voids ? `${input.voids} canastas se anularon.` : "", "Información, no asesoría."].filter(Boolean).join(" ");
  }
  const parts = lines.map((g, i) => `Basket ${i + 1}: ${g.hit ? `beat SPY by ${pct(g.vs_spy_pct)} percent` : `trailed SPY by ${pct(g.vs_spy_pct)} percent`}.`);
  return [`Nightshift Signals morning brief for ${input.date}.`, n ? `Of last night's ${n} baskets, ${wins} beat SPY.` : "No baskets were graded last night.", ...parts, input.voids ? `${input.voids} were voided.` : "", "Information, not advice."].filter(Boolean).join(" ");
}
