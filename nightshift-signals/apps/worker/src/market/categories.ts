import { CATEGORIES, leagueWeek } from "@nightshift-signals/core";
import { and, baskets, categoryOverrides, eq, events, gte, grades, lt } from "@nightshift-signals/db";
import type { Deps } from "../deps";

export const LOSING_WEEKS_TO_DISABLE = 4;

/**
 * Weekly: a category whose baskets hit SPY at 50% or less in each of the last four completed weeks
 * (with at least one graded basket each week) is disabled and flagged. Re-enabling is a human decision.
 */
export async function reviewCategories(deps: Deps): Promise<string[]> {
  const thisWeek = leagueWeek(deps.now());
  const weeks = Array.from({ length: LOSING_WEEKS_TO_DISABLE }, (_, i) => {
    const end = new Date(thisWeek.start.getTime() - i * 7 * 86_400_000);
    return { start: new Date(end.getTime() - 7 * 86_400_000), end };
  });
  const disabled: string[] = [];
  for (const c of CATEGORIES) {
    let losing = 0;
    for (const w of weeks) {
      const rows = await deps.db
        .select({ hit: grades.hit })
        .from(grades)
        .innerJoin(baskets, eq(grades.basketId, baskets.id))
        .innerJoin(events, eq(baskets.eventId, events.id))
        .where(and(eq(events.category, c), gte(grades.gradedAt, w.start), lt(grades.gradedAt, w.end)));
      if (rows.length && rows.filter((r) => r.hit).length / rows.length <= 0.5) losing++;
    }
    if (losing < LOSING_WEEKS_TO_DISABLE) continue;
    const [existing] = await deps.db.select().from(categoryOverrides).where(eq(categoryOverrides.category, c));
    if (existing?.disabled) continue;
    const reason = `auto: hit rate at or below 50% for ${LOSING_WEEKS_TO_DISABLE} straight weeks (to ${thisWeek.label})`;
    await deps.db
      .insert(categoryOverrides)
      .values({ category: c, disabled: true, reason })
      .onConflictDoUpdate({ target: categoryOverrides.category, set: { disabled: true, reason, updatedAt: deps.now() } });
    deps.log(`[categories] DISABLED ${c}: ${reason}. Review before re-enabling.`);
    disabled.push(c);
  }
  return disabled;
}

export async function isCategoryDisabled(deps: Deps, c: string): Promise<boolean> {
  const [o] = await deps.db.select().from(categoryOverrides).where(eq(categoryOverrides.category, c as (typeof CATEGORIES)[number]));
  return o?.disabled ?? false;
}
