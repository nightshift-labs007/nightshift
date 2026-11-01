import "server-only";
import { env } from "./env";

/** Minimal Upstash Redis (REST) client: the private store for profiles. Off when Upstash isn't connected. */
export const kvEnabled = () => !!(env.upstashUrl && env.upstashToken);

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

export const kvGet = (key: string) => cmd<string | null>(["GET", key]);
export const kvSet = (key: string, value: string) => cmd<string>(["SET", key, value]);
export const kvDel = (key: string) => cmd<number>(["DEL", key]);
export const kvMGet = (keys: string[]) => (keys.length ? cmd<(string | null)[]>(["MGET", ...keys]) : Promise.resolve([]));
export const kvHSet = (key: string, field: string, value: string) => cmd<number>(["HSET", key, field, value]);
export const kvHLen = (key: string) => cmd<number>(["HLEN", key]);
/** SET only if the key is new, optionally expiring after `exSec`. True when it was set. */
export const kvSetNX = async (key: string, value: string, exSec?: number) => (await cmd<string | null>(exSec ? ["SET", key, value, "NX", "EX", exSec] : ["SET", key, value, "NX"])) === "OK";
export const kvSetEx = (key: string, value: string, exSec: number) => cmd<string>(["SET", key, value, "EX", exSec]);
export const kvHGet = (key: string, field: string) => cmd<string | null>(["HGET", key, field]);
export const kvHSetNX = (key: string, field: string, value: string) => cmd<number>(["HSETNX", key, field, value]);
export const kvHDel = (key: string, field: string) => cmd<number>(["HDEL", key, field]);
export const kvHIncrBy = (key: string, field: string, by: number) => cmd<number>(["HINCRBY", key, field, by]);
/** A whole hash as an object (Upstash returns it as a flat [field, value, …] list). */
export const kvHGetAll = async (key: string) => {
  const flat = await cmd<string[]>(["HGETALL", key]);
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
};
export const kvSAdd = (key: string, member: string) => cmd<number>(["SADD", key, member]);
export const kvSMembers = (key: string) => cmd<string[]>(["SMEMBERS", key]);
