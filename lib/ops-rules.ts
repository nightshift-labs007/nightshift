// Go-live operations: pure rules (no imports), tested in test/ops.test.mjs.

/** The scheduled jobs and how often the scheduler should run them. A job is stale after 3 missed intervals. */
export const JOBS = {
  keeper: { everyMin: 10, what: "On-chain keeper: oracle prices, Guardian, Stack, Call the Open rounds" },
  settle: { everyMin: 5, what: "Settle points-game rounds after the open" },
  reminders: { everyMin: 5, what: "Send reminder emails" },
  aiCall: { everyMin: 5, what: "Take Nightshift's 20:00 ET call for Beat the AI" },
} as const;
export type JobName = keyof typeof JOBS;

export type JobBeat = { lastRunAt: number | null; lastScheduledAt: number | null; lastOkAt: number | null; lastError: string | null; lastErrorAt: number | null; lastSummary: string | null };

/** Stale = the scheduler hasn't run the job successfully for 3 intervals (page-triggered runs don't count). */
export function jobStale(job: JobName, b: JobBeat | null, now: number): boolean {
  const limit = 3 * JOBS[job].everyMin * 60_000;
  if (!b?.lastScheduledAt) return true;
  return now - b.lastScheduledAt > limit || !b.lastOkAt || now - b.lastOkAt > limit;
}

/** Keep error text short and free of anything that looks like a secret, an email or a long hex id. */
export function scrub(s: string, max = 300): string {
  return s
    .replace(/(bearer|token|key|secret|password)[=:\s]+\S+/gi, "$1=[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/0x[0-9a-fA-F]{40,}/g, "0x[hex]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .slice(0, max);
}

/** Add `n` days to a YYYY-MM-DD date. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type Cohort = { date: string; users: number; d1: number | null; d7: number | null };

/**
 * Day-1 and day-7 return by first-seen cohort: of the players first seen on day D, how many were active again on
 * D+1 and on D+7. Null when that day hasn't happened yet (relative to `today`), so a young cohort isn't shown as 0%.
 */
export function retention(firstSeen: Record<string, string>, activeOn: Record<string, string[]>, today: string): Cohort[] {
  const byDay = new Map<string, string[]>();
  for (const [uid, d] of Object.entries(firstSeen)) byDay.set(d, [...(byDay.get(d) ?? []), uid]);
  const sets = new Map(Object.entries(activeOn).map(([d, xs]) => [d, new Set(xs)]));
  return [...byDay.keys()].sort().map((date) => {
    const users = byDay.get(date)!;
    const back = (k: number) => {
      const day = addDays(date, k);
      if (day > today) return null;
      const s = sets.get(day);
      return users.filter((u) => s?.has(u)).length;
    };
    return { date, users: users.length, d1: back(1), d7: back(7) };
  });
}
