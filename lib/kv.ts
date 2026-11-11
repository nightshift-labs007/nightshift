import "server-only";
import postgres from "postgres";
import { env } from "./env";

/**
 * The private store for profiles, members, the waitlist, ledger stamps and rate limits: a small Redis-style
 * key/value API. Backed by Postgres when DATABASE_URL is set (production, on Railway); otherwise by Upstash Redis
 * (REST) when that is configured; otherwise off.
 */
export const kvBackend = (): "postgres" | "upstash" | null =>
  env.databaseUrl ? "postgres" : env.upstashUrl && env.upstashToken ? "upstash" : null;
export const kvEnabled = () => kvBackend() !== null;

// ---------------------------------------------------------------------------------------------------------------
// Postgres: strings (with optional expiry), hashes and sets, one table each. Created on first use.

let sqlClient: postgres.Sql | null = null;
let ready: Promise<void> | null = null;

function sql(): postgres.Sql {
  sqlClient ??= postgres(env.databaseUrl, { max: 5, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
  return sqlClient;
}

async function db(): Promise<postgres.Sql> {
  const q = sql();
  ready ??= (async () => {
    await q`create table if not exists kv_string (key text primary key, value text not null, expires_at timestamptz)`;
    await q`create index if not exists kv_string_expires on kv_string (expires_at) where expires_at is not null`;
    await q`create table if not exists kv_hash (key text not null, field text not null, value text not null, primary key (key, field))`;
    await q`create table if not exists kv_set (key text not null, member text not null, primary key (key, member))`;
  })().catch((e) => {
    ready = null; // retry on the next call
    throw e;
  });
  await ready;
  return q;
}

const live = (q: postgres.Sql) => q`(expires_at is null or expires_at > now())`;
const expiry = (exSec?: number) => (exSec ? new Date(Date.now() + exSec * 1000) : null);

// Expired rows are invisible to reads; this clears them out now and then.
let lastSweep = 0;
function sweep(q: postgres.Sql) {
  if (Date.now() - lastSweep < 10 * 60_000) return;
  lastSweep = Date.now();
  void q`delete from kv_string where expires_at <= now()`.catch(() => {});
}

const pg = {
  async get(key: string) {
    const q = await db();
    const [r] = await q<{ value: string }[]>`select value from kv_string where key = ${key} and ${live(q)}`;
    return r?.value ?? null;
  },
  async set(key: string, value: string, exSec?: number) {
    const q = await db();
    await q`insert into kv_string (key, value, expires_at) values (${key}, ${value}, ${expiry(exSec)})
            on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`;
    if (exSec) sweep(q);
    return "OK";
  },
  /** Sets only when the key is absent or expired. */
  async setNX(key: string, value: string, exSec?: number) {
    const q = await db();
    const r = await q`insert into kv_string (key, value, expires_at) values (${key}, ${value}, ${expiry(exSec)})
                      on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at
                      where kv_string.expires_at is not null and kv_string.expires_at <= now()
                      returning 1`;
    if (exSec) sweep(q);
    return r.length > 0;
  },
  /** INCR with the expiry set when the counter starts (the fixed-window rate limiter). */
  async incrWindow(key: string, windowSec: number) {
    const q = await db();
    const [r] = await q<{ value: string }[]>`
      insert into kv_string (key, value, expires_at) values (${key}, '1', ${expiry(windowSec)})
      on conflict (key) do update set
        value = case when kv_string.expires_at <= now() then '1' else (kv_string.value::bigint + 1)::text end,
        expires_at = case when kv_string.expires_at <= now() then excluded.expires_at else kv_string.expires_at end
      returning value`;
    sweep(q);
    return Number(r.value);
  },
  async del(key: string) {
    const q = await db();
    const [a, b, c] = await q.begin((t) => [
      t`delete from kv_string where key = ${key} and ${live(t)}`,
      t`delete from kv_hash where key = ${key}`,
      t`delete from kv_set where key = ${key}`,
    ]);
    return a.count + (b.count > 0 ? 1 : 0) + (c.count > 0 ? 1 : 0);
  },
  async mget(keys: string[]) {
    const q = await db();
    const rows = await q<{ key: string; value: string }[]>`select key, value from kv_string where key in ${q(keys)} and ${live(q)}`;
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return keys.map((k) => m.get(k) ?? null);
  },
  async hset(key: string, field: string, value: string) {
    const q = await db();
    const [r] = await q<{ inserted: boolean }[]>`
      insert into kv_hash (key, field, value) values (${key}, ${field}, ${value})
      on conflict (key, field) do update set value = excluded.value
      returning (xmax = 0) as inserted`;
    return r.inserted ? 1 : 0;
  },
  async hsetNX(key: string, field: string, value: string) {
    const q = await db();
    const r = await q`insert into kv_hash (key, field, value) values (${key}, ${field}, ${value}) on conflict do nothing returning 1`;
    return r.length;
  },
  async hget(key: string, field: string) {
    const q = await db();
    const [r] = await q<{ value: string }[]>`select value from kv_hash where key = ${key} and field = ${field}`;
    return r?.value ?? null;
  },
  async hdel(key: string, field: string) {
    const q = await db();
    return (await q`delete from kv_hash where key = ${key} and field = ${field}`).count;
  },
  async hlen(key: string) {
    const q = await db();
    const [r] = await q<{ n: number }[]>`select count(*)::int as n from kv_hash where key = ${key}`;
    return r.n;
  },
  async hincrBy(key: string, field: string, by: number) {
    const q = await db();
    const [r] = await q<{ value: string }[]>`
      insert into kv_hash (key, field, value) values (${key}, ${field}, ${String(by)})
      on conflict (key, field) do update set value = (kv_hash.value::bigint + ${by})::text
      returning value`;
    return Number(r.value);
  },
  async hgetAll(key: string) {
    const q = await db();
    const rows = await q<{ field: string; value: string }[]>`select field, value from kv_hash where key = ${key}`;
    return Object.fromEntries(rows.map((r) => [r.field, r.value])) as Record<string, string>;
  },
  async sadd(key: string, member: string) {
    const q = await db();
    return (await q`insert into kv_set (key, member) values (${key}, ${member}) on conflict do nothing returning 1`).length;
  },
  async smembers(key: string) {
    const q = await db();
    return (await q<{ member: string }[]>`select member from kv_set where key = ${key}`).map((r) => r.member);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Upstash Redis (REST): the previous store, still used when DATABASE_URL is not set.

async function cmd<T>(args: (string | number)[]): Promise<T> {
  const res = await fetch(env.upstashUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.upstashToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  const j = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
  if (!res.ok || !j || j.error) throw new Error(`kv: ${j?.error ?? res.status}`);
  return j.result as T;
}

const usePg = () => kvBackend() === "postgres";

export const kvGet = (key: string) => (usePg() ? pg.get(key) : cmd<string | null>(["GET", key]));
export const kvSet = (key: string, value: string) => (usePg() ? pg.set(key, value) : cmd<string>(["SET", key, value]));
export const kvDel = (key: string) => (usePg() ? pg.del(key) : cmd<number>(["DEL", key]));
export const kvMGet = (keys: string[]): Promise<(string | null)[]> =>
  !keys.length ? Promise.resolve([]) : usePg() ? pg.mget(keys) : cmd<(string | null)[]>(["MGET", ...keys]);
export const kvHSet = (key: string, field: string, value: string) => (usePg() ? pg.hset(key, field, value) : cmd<number>(["HSET", key, field, value]));
export const kvHLen = (key: string) => (usePg() ? pg.hlen(key) : cmd<number>(["HLEN", key]));
/** SET only if the key is new, optionally expiring after `exSec`. True when it was set. */
export const kvSetNX = async (key: string, value: string, exSec?: number) =>
  usePg() ? pg.setNX(key, value, exSec) : (await cmd<string | null>(exSec ? ["SET", key, value, "NX", "EX", exSec] : ["SET", key, value, "NX"])) === "OK";
export const kvSetEx = (key: string, value: string, exSec: number) => (usePg() ? pg.set(key, value, exSec) : cmd<string>(["SET", key, value, "EX", exSec]));
/** INCR a counter that expires `windowSec` after it starts. */
export const kvIncrWindow = async (key: string, windowSec: number): Promise<number> => {
  if (usePg()) return pg.incrWindow(key, windowSec);
  const res = await fetch(`${env.upstashUrl}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.upstashToken}` },
    body: JSON.stringify([["INCR", key], ["EXPIRE", key, String(windowSec)]]),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => null)) as { result: number }[] | null;
  return j?.[0]?.result ?? 0;
};
export const kvHGet = (key: string, field: string) => (usePg() ? pg.hget(key, field) : cmd<string | null>(["HGET", key, field]));
export const kvHSetNX = (key: string, field: string, value: string) => (usePg() ? pg.hsetNX(key, field, value) : cmd<number>(["HSETNX", key, field, value]));
export const kvHDel = (key: string, field: string) => (usePg() ? pg.hdel(key, field) : cmd<number>(["HDEL", key, field]));
export const kvHIncrBy = (key: string, field: string, by: number) => (usePg() ? pg.hincrBy(key, field, by) : cmd<number>(["HINCRBY", key, field, by]));
/** A whole hash as an object (Upstash returns it as a flat [field, value, …] list). */
export const kvHGetAll = async (key: string): Promise<Record<string, string>> => {
  if (usePg()) return pg.hgetAll(key);
  const flat = await cmd<string[]>(["HGETALL", key]);
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
};
export const kvSAdd = (key: string, member: string) => (usePg() ? pg.sadd(key, member) : cmd<number>(["SADD", key, member]));
export const kvSMembers = (key: string) => (usePg() ? pg.smembers(key) : cmd<string[]>(["SMEMBERS", key]));
