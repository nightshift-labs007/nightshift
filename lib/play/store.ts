import "server-only";
import { kvEnabled, kvGet, kvHGetAll, kvHIncrBy, kvHSet, kvSAdd, kvSet, kvSetNX, kvSMembers } from "@/lib/kv";
import type { RoundResult, Side } from "@/lib/play-rules";

/**
 * Storage for the points game. Upstash Redis when configured (production); otherwise an in-process memory store,
 * so the game works on a local server without secrets (it resets when the server restarts).
 *
 *   play:u:{uid}        hash  "{date}|{ticker}" → "up" | "down"     a player's picks
 *   play:c:{date}       hash  "{ticker}|{side}" → count             how many picked each side (crowd split)
 *   play:r:{date}       string RoundResult JSON                       the settled (or void) result
 *   play:rounds         set   dates that have at least one pick       what the settle job looks at
 */
type Mem = { str: Map<string, { v: string; exp: number }>; hash: Map<string, Map<string, string>>; set: Map<string, Set<string>> };
const g = globalThis as unknown as { __playMem?: Mem };
const mem: Mem = (g.__playMem ??= { str: new Map(), hash: new Map(), set: new Map() });

const memGet = (k: string) => {
  const x = mem.str.get(k);
  if (!x) return null;
  if (x.exp && x.exp < Date.now()) return (mem.str.delete(k), null);
  return x.v;
};
const hashOf = (k: string) => mem.hash.get(k) ?? mem.hash.set(k, new Map()).get(k)!;

export const storeKind = () => (kvEnabled() ? "redis" : "memory");

export async function getPicks(uid: string): Promise<Record<string, Record<string, Side>>> {
  const raw = kvEnabled() ? await kvHGetAll(`play:u:${uid}`) : Object.fromEntries(hashOf(`play:u:${uid}`));
  const out: Record<string, Record<string, Side>> = {};
  for (const [field, side] of Object.entries(raw)) {
    const [date, ticker] = field.split("|");
    if (side === "up" || side === "down") (out[date] ??= {})[ticker] = side;
  }
  return out;
}

/** Stores a pick (replacing an earlier one for the same asset and round) and keeps the crowd counts in step. */
export async function setPick(uid: string, date: string, ticker: string, side: Side): Promise<void> {
  const field = `${date}|${ticker}`;
  const prev = (await getPicks(uid))[date]?.[ticker] ?? null;
  if (prev === side) return;
  if (kvEnabled()) {
    await kvHSet(`play:u:${uid}`, field, side);
    await kvHIncrBy(`play:c:${date}`, `${ticker}|${side}`, 1);
    if (prev) await kvHIncrBy(`play:c:${date}`, `${ticker}|${prev}`, -1);
    await kvSAdd("play:rounds", date);
    return;
  }
  hashOf(`play:u:${uid}`).set(field, side);
  const c = hashOf(`play:c:${date}`);
  c.set(`${ticker}|${side}`, String(Number(c.get(`${ticker}|${side}`) ?? 0) + 1));
  if (prev) c.set(`${ticker}|${prev}`, String(Math.max(0, Number(c.get(`${ticker}|${prev}`) ?? 0) - 1)));
  (mem.set.get("play:rounds") ?? mem.set.set("play:rounds", new Set()).get("play:rounds")!).add(date);
}

export async function getCounts(date: string): Promise<Record<string, { up: number; down: number }>> {
  const raw = kvEnabled() ? await kvHGetAll(`play:c:${date}`) : Object.fromEntries(hashOf(`play:c:${date}`));
  const out: Record<string, { up: number; down: number }> = {};
  for (const [field, n] of Object.entries(raw)) {
    const [ticker, side] = field.split("|");
    if (side === "up" || side === "down") (out[ticker] ??= { up: 0, down: 0 })[side] = Math.max(0, Number(n) || 0);
  }
  return out;
}

export async function getResult(date: string): Promise<RoundResult | null> {
  const v = kvEnabled() ? await kvGet(`play:r:${date}`) : memGet(`play:r:${date}`);
  try {
    return v ? (JSON.parse(v) as RoundResult) : null;
  } catch {
    return null;
  }
}

export async function setResult(r: RoundResult): Promise<void> {
  const v = JSON.stringify(r);
  if (kvEnabled()) await kvSet(`play:r:${r.date}`, v);
  else mem.str.set(`play:r:${r.date}`, { v, exp: 0 });
}

export async function roundsWithPicks(): Promise<string[]> {
  const xs = kvEnabled() ? await kvSMembers("play:rounds") : [...(mem.set.get("play:rounds") ?? [])];
  return xs.sort();
}

/** A short-lived lock so two requests don't settle the same round at once. */
export async function tryLock(key: string, sec: number): Promise<boolean> {
  if (kvEnabled()) return kvSetNX(key, "1", sec);
  if (memGet(key)) return false;
  mem.str.set(key, { v: "1", exp: Date.now() + sec * 1000 });
  return true;
}
