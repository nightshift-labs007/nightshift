import type { ScorecardPost } from "@nightshift-signals/adapters";
import { baskets, eq, grades, inArray } from "@nightshift-signals/db";
import type { Deps } from "./deps";
import type { GradeSummary } from "./stages/grade";

/** The 9:45 ET morning post: every basket graded today, misses and voids included. */
export async function morningPost(deps: Deps, s: GradeSummary): Promise<ScorecardPost> {
  const rows = s.graded.length
    ? await deps.db
        .select({ id: baskets.id, thesis: baskets.thesis, ret: grades.retPct, alpha: grades.vsSpyPct, hit: grades.hit })
        .from(grades)
        .innerJoin(baskets, eq(grades.basketId, baskets.id))
        .where(inArray(grades.basketId, s.graded))
    : [];
  return {
    date: s.date,
    url: `${deps.appUrl}/scorecard/${s.date}`,
    graded: rows.map((r) => ({ basket_id: r.id, thesis: r.thesis, ret_pct: r.ret, vs_spy_pct: r.alpha, hit: r.hit })),
    voids: s.voided.map((v) => ({ basket_id: v.basket_id, reason: v.reason })),
    hit_rate: rows.length ? rows.filter((r) => r.hit).length / rows.length : null,
  };
}

export async function publishMorningScorecard(deps: Deps, s: GradeSummary): Promise<void> {
  if (s.graded.length === 0 && s.voided.length === 0) return;
  const post = await morningPost(deps, s);
  const results = await Promise.allSettled(deps.notifiers.map((n) => n.publishScorecard(post)));
  results.forEach((r, i) => r.status === "rejected" && deps.log(`[scorecard] ${deps.notifiers[i]!.channel} failed`, { error: String(r.reason) }));
}
