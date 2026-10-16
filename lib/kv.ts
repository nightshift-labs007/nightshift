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
