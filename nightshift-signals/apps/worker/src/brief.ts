import { templateBrief, writeBrief, type BriefInput } from "@nightshift-signals/ai";
import { LOCALES } from "@nightshift-signals/core";
import { baskets, briefs, eq, grades, inArray } from "@nightshift-signals/db";
import type { Deps } from "./deps";
import type { GradeSummary } from "./stages/grade";

/** After grading: one brief per language, written by the model when available, else from the template; audio if TTS is set. */
export async function makeBriefs(deps: Deps, s: GradeSummary): Promise<void> {
  const rows = s.graded.length
    ? await deps.db
        .select({ thesis: baskets.thesis, ret: grades.retPct, vs: grades.vsSpyPct, hit: grades.hit })
        .from(grades)
        .innerJoin(baskets, eq(grades.basketId, baskets.id))
        .where(inArray(grades.basketId, s.graded))
    : [];
  if (rows.length === 0 && s.voided.length === 0) return;
  const input: BriefInput = {
    date: s.date,
    hit_rate: rows.length ? rows.filter((r) => r.hit).length / rows.length : null,
    graded: rows.map((r) => ({ thesis: r.thesis, ret_pct: r.ret, vs_spy_pct: r.vs, hit: r.hit })),
    voids: s.voided.length,
  };
  await Promise.all(
    LOCALES.map(async (lang) => {
      const written = await writeBrief(deps.model, input, lang).catch(() => null);
      const script = written ?? templateBrief(input, lang);
      const audio = deps.tts ? await deps.tts.synthesize(script, lang).catch((e) => (deps.log(`[brief] tts ${lang} failed`, { error: String(e) }), null)) : null;
      const row = { script, source: written ? "model" : "template", audio: audio?.audio ?? null, audioMime: audio?.mime ?? null };
      await deps.db.insert(briefs).values({ date: s.date, lang, ...row }).onConflictDoUpdate({ target: [briefs.date, briefs.lang], set: row });
    }),
  );
}
