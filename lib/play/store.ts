import "server-only";
import { kvDel, kvEnabled, kvGet, kvHDel, kvHGet, kvHGetAll, kvHIncrBy, kvHSet, kvSAdd, kvSet, kvSetEx, kvSetNX, kvSMembers, kvSRem } from "@/lib/kv";
import type { RoundResult, Side } from "@/lib/play-rules";

/**
 * Storage for the points games. Upstash Redis when configured (production); otherwise an in-process memory store,
 * so everything works on a local server without secrets (it resets when the server restarts).
 *
 * Two games share the layout, keyed by mode ("close" = up/down vs the close, "ai" = Beat the AI):
 *   play:u:{uid} / play:ua:{uid}        hash "{date}|{ticker}" → "up" | "down"   a player's picks
 *   play:c:{date} / play:ca:{date}      hash "{ticker}|{side}" → count           crowd split
 *   play:r:{date} / play:ra:{date}      RoundResult JSON                         settled or void
 *   play:rounds / play:rounds:ai        set of dates with at least one pick      what settlement looks at
 * Plus accounts, reminders and the price cache, through the generic helpers at the bottom.
 */
export type Mode = "close" | "ai";
const K = {
  picks: (m: Mode, uid: string) => (m === "ai" ? `play:ua:${uid}` : `play:u:${uid}`),
  counts: (m: Mode, date: string) => (m === "ai" ? `play:ca:${date}` : `play:c:${date}`),
  result: (m: Mode, date: string) => (m === "ai" ? `play:ra:${date}` : `play:r:${date}`),
  rounds: (m: Mode) => (m === "ai" ? "play:rounds:ai" : "play:rounds"),
};

// ---------------------------------------------------------------- generic helpers (Redis or memory)

type Mem = { str: Map<string, { v: string; exp: number }>; hash: Map<string, Map<string, string>>; set: Map<string, Set<string>> };
const g = globalThis as unknown as { __playMem?: Mem };
const mem: Mem = (g.__playMem ??= { str: new Map(), hash: new Map(), set: new Map() });
const memStr = (k: string) => {
  const x = mem.str.get(k);
  if (!x) return null;
  if (x.exp && x.exp < Date.now()) return (mem.str.delete(k), null);
  return x.v;
};
const memHash = (k: string) => mem.hash.get(k) ?? mem.hash.set(k, new Map()).get(k)!;
const memSet = (k: string) => mem.set.get(k) ?? mem.set.set(k, new Set()).get(k)!;

export const storeKind = () => (kvEnabled() ? "redis" : "memory");

export const sGet = (k: string) => (kvEnabled() ? kvGet(k) : Promise.resolve(memStr(k)));
export async function sSet(k: string, v: string, ttlSec?: number) {
  if (kvEnabled()) await (ttlSec ? kvSetEx(k, v, ttlSec) : kvSet(k, v));
  else mem.str.set(k, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}
export async function sDel(k: string) {
  if (kvEnabled()) await kvDel(k);
  else mem.str.delete(k);
}
/** Set only if absent (a lock or a "sent once" marker). */
export async function sSetNX(k: string, v: string, ttlSec: number) {
  if (kvEnabled()) return kvSetNX(k, v, ttlSec);
  if (memStr(k)) return false;
  mem.str.set(k, { v, exp: Date.now() + ttlSec * 1000 });
  return true;
}
export const hGet = (k: string, f: string) => (kvEnabled() ? kvHGet(k, f) : Promise.resolve(memHash(k).get(f) ?? null));
export async function hSet(k: string, f: string, v: string) {
  if (kvEnabled()) await kvHSet(k, f, v);
  else memHash(k).set(f, v);
}
export async function hDel(k: string, f: string) {
  if (kvEnabled()) await kvHDel(k, f);
  else memHash(k).delete(f);
}
export const hGetAll = async (k: string): Promise<Record<string, string>> => (kvEnabled() ? kvHGetAll(k) : Object.fromEntries(memHash(k)));
export async function hIncr(k: string, f: string, by: number) {
  if (kvEnabled()) await kvHIncrBy(k, f, by);
  else memHash(k).set(f, String(Math.max(0, Number(memHash(k).get(f) ?? 0) + by)));
}
export async function setAdd(k: string, m: string) {
  if (kvEnabled()) await kvSAdd(k, m);
  else memSet(k).add(m);
}
export const setMembers = async (k: string): Promise<string[]> => (kvEnabled() ? kvSMembers(k) : [...memSet(k)]);
export async function setRemove(k: string, m: string) {
  if (kvEnabled()) await kvSRem(k, m);
  else memSet(k).delete(m);
}
/** Deletes a whole key (string or hash). */
export async function delKey(k: string) {
  if (kvEnabled()) await kvDel(k);
  else (mem.str.delete(k), mem.hash.delete(k), mem.set.delete(k));
}

/** Permanent cache for immutable values (an official close or open). */
export const cacheGet = (k: string) => sGet(k);
export const cacheSet = (k: string, v: string) => sSet(k, v);

/** A short-lived lock so two requests don't do the same work at once. */
export const tryLock = (key: string, sec: number) => sSetNX(key, "1", sec);

// ---------------------------------------------------------------- picks, counts, results

export async function getPicks(uid: string, mode: Mode = "close"): Promise<Record<string, Record<string, Side>>> {
  const out: Record<string, Record<string, Side>> = {};
  for (const [field, side] of Object.entries(await hGetAll(K.picks(mode, uid)))) {
    const [date, ticker] = field.split("|");
    if (side === "up" || side === "down") (out[date] ??= {})[ticker] = side;
  }
  return out;
}

/** Stores a pick (replacing an earlier one for the same asset and round) and keeps the crowd counts in step. */
export async function setPick(uid: string, date: string, ticker: string, side: Side, mode: Mode = "close"): Promise<void> {
  const prev = (await hGet(K.picks(mode, uid), `${date}|${ticker}`)) as Side | null;
  if (prev === side) return;
  await hSet(K.picks(mode, uid), `${date}|${ticker}`, side);
  await hIncr(K.counts(mode, date), `${ticker}|${side}`, 1);
  if (prev === "up" || prev === "down") await hIncr(K.counts(mode, date), `${ticker}|${prev}`, -1);
  await setAdd(K.rounds(mode), date);
}

/** Removes a pick and its crowd count (used when merging a browser into an account that already picked). */
export async function dropPick(uid: string, date: string, ticker: string, mode: Mode = "close"): Promise<void> {
  const prev = await hGet(K.picks(mode, uid), `${date}|${ticker}`);
  if (prev !== "up" && prev !== "down") return;
  await hDel(K.picks(mode, uid), `${date}|${ticker}`);
  await hIncr(K.counts(mode, date), `${ticker}|${prev}`, -1);
}

export async function getCounts(date: string, mode: Mode = "close"): Promise<Record<string, { up: number; down: number }>> {
  const out: Record<string, { up: number; down: number }> = {};
  for (const [field, n] of Object.entries(await hGetAll(K.counts(mode, date)))) {
    const [ticker, side] = field.split("|");
    if (side === "up" || side === "down") (out[ticker] ??= { up: 0, down: 0 })[side] = Math.max(0, Number(n) || 0);
  }
  return out;
}

export async function getResult(date: string, mode: Mode = "close"): Promise<RoundResult | null> {
  const v = await sGet(K.result(mode, date));
  try {
    return v ? (JSON.parse(v) as RoundResult) : null;
  } catch {
    return null;
  }
}

export const setResult = (r: RoundResult, mode: Mode = "close") => sSet(K.result(mode, r.date), JSON.stringify(r));

export const roundsWithPicks = async (mode: Mode = "close") => (await setMembers(K.rounds(mode))).sort();
