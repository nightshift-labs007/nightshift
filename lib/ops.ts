import "server-only";
import { JOBS, jobStale, retention, scrub, type JobBeat, type JobName } from "@/lib/ops-rules";
import { hGet, hGetAll, hIncr, hSet, sGet, sSet, setAdd, setMembers } from "@/lib/play/store";
import { etParts } from "@/lib/time";

/**
 * Go-live operations on the same store as the game (Redis in production, memory locally):
 *   - job heartbeats: when each scheduled job last ran, last succeeded, and its last error
 *   - an error log: the last 50 server and browser errors, scrubbed of secrets and emails
 *   - analytics: daily event counts and who was active each day (anonymous player ids only, never IPs or emails)
 */

// ---------------------------------------------------------------- job heartbeats

/** Runs a job and records the outcome. `scheduled` = called by the scheduler (only those count for staleness). */
export async function runJob<T>(job: JobName, scheduled: boolean, fn: () => Promise<T>): Promise<T | { error: string }> {
  const at = Date.now();
  const prev = await jobBeat(job);
  try {
    const out = await fn();
    const summary = scrub(JSON.stringify(out) ?? "", 200);
    await saveBeat(job, { ...prev, lastRunAt: at, lastScheduledAt: scheduled ? at : prev.lastScheduledAt, lastOkAt: Date.now(), lastSummary: summary });
    return out;
  } catch (e) {
    const msg = scrub(String(e instanceof Error ? e.message : e));
    await saveBeat(job, { ...prev, lastRunAt: at, lastScheduledAt: scheduled ? at : prev.lastScheduledAt, lastError: msg, lastErrorAt: Date.now() });
    await reportError(`job:${job}`, msg);
    return { error: msg };
  }
}

const EMPTY: JobBeat = { lastRunAt: null, lastScheduledAt: null, lastOkAt: null, lastError: null, lastErrorAt: null, lastSummary: null };
async function jobBeat(job: JobName): Promise<JobBeat> {
  const v = await hGet("ops:jobs", job).catch(() => null);
  try {
    return v ? { ...EMPTY, ...(JSON.parse(v) as JobBeat) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}
const saveBeat = (job: JobName, b: JobBeat) => hSet("ops:jobs", job, JSON.stringify(b)).catch(() => {});

export async function jobsStatus(now = Date.now()) {
  const all = await hGetAll("ops:jobs").catch(() => ({}) as Record<string, string>);
  return Object.fromEntries(
    (Object.keys(JOBS) as JobName[]).map((job) => {
      let b: JobBeat = { ...EMPTY };
      try {
        if (all[job]) b = { ...EMPTY, ...JSON.parse(all[job]) };
      } catch {}
      const iso = (t: number | null) => (t ? new Date(t).toISOString() : null);
      return [
        job,
        {
          what: JOBS[job].what,
          expectedEveryMin: JOBS[job].everyMin,
          stale: jobStale(job, b, now),
          lastRunAt: iso(b.lastRunAt),
          lastScheduledAt: iso(b.lastScheduledAt),
          lastOkAt: iso(b.lastOkAt),
          lastError: b.lastError,
          lastErrorAt: iso(b.lastErrorAt),
          lastSummary: b.lastSummary,
        },
      ];
    }),
  );
}

// ---------------------------------------------------------------- error log

const ERR_SLOTS = 50;
export async function reportError(where: string, err: unknown) {
  const msg = scrub(String(err instanceof Error ? `${err.name}: ${err.message}` : err));
  console.error(`[nightshift] ${where}: ${msg}`);
  try {
    const n = Number((await sGet("ops:err:n")) ?? 0) + 1;
    await sSet("ops:err:n", String(n));
    await hSet("ops:errors", String(n % ERR_SLOTS), JSON.stringify({ n, at: Date.now(), where: scrub(where, 80), msg }));
  } catch {}
}

export async function recentErrors(): Promise<{ n: number; at: string; where: string; msg: string }[]> {
  const all = await hGetAll("ops:errors").catch(() => ({}) as Record<string, string>);
  return Object.values(all)
    .map((v) => {
      try {
        const e = JSON.parse(v) as { n: number; at: number; where: string; msg: string };
        return { ...e, at: new Date(e.at).toISOString() };
      } catch {
        return null;
      }
    })
    .filter((e): e is { n: number; at: string; where: string; msg: string } => !!e)
    .sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------- analytics

/**
 * Events: visit, pick, signup, share_created, share_view, reminder_sent, reminder_click, code_sent.
 * Stored as daily counts (an:c:{date}), plus, for a player id, the day they were first seen (an:first) and the days
 * they were active (an:act:{date}). No IPs, emails or user agents.
 */
export type EventName = "visit" | "pick" | "signup" | "share_created" | "share_view" | "reminder_sent" | "reminder_click" | "code_sent";

export async function track(event: EventName, uid: string | null = null, now = Date.now()) {
  try {
    const day = etParts(now).date;
    await hIncr(`an:c:${day}`, event, 1);
    if (uid && (event === "visit" || event === "pick" || event === "signup" || event === "reminder_click")) {
      if (!(await hGet("an:first", uid))) await hSet("an:first", uid, day);
      await setAdd(`an:act:${day}`, uid);
      if (event === "pick") await hIncr(`an:picks:${day}`, uid, 1);
    }
  } catch {}
}

/** Daily counts, picks per active player, and day-1 / day-7 return by first-seen cohort, for the last `days` days. */
export async function metrics(days = 14, now = Date.now()) {
  const today = etParts(now).date;
  const dates = Array.from({ length: days }, (_, i) => etParts(now - (days - 1 - i) * 86_400_000).date);
  const [first, ...rest] = await Promise.all([
    hGetAll("an:first"),
    ...dates.map((d) => hGetAll(`an:c:${d}`)),
    ...dates.map((d) => setMembers(`an:act:${d}`)),
    ...dates.map((d) => hGetAll(`an:picks:${d}`)),
  ]);
  const counts = rest.slice(0, days) as Record<string, string>[];
  const active = rest.slice(days, 2 * days) as string[][];
  const picks = rest.slice(2 * days) as Record<string, string>[];
  const daily = dates.map((d, i) => {
    const pickers = Object.values(picks[i]).map(Number);
    return {
      date: d,
      events: Object.fromEntries(Object.entries(counts[i]).map(([k, v]) => [k, Number(v)])),
      activePlayers: active[i].length,
      picksPerPicker: pickers.length ? Math.round((pickers.reduce((a, b) => a + b, 0) / pickers.length) * 10) / 10 : null,
    };
  });
  const inWindow = Object.fromEntries(Object.entries(first as Record<string, string>).filter(([, d]) => d >= dates[0]));
  return { today, daily, cohorts: retention(inWindow, Object.fromEntries(dates.map((d, i) => [d, active[i]])), today) };
}
