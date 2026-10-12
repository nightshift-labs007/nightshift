import "server-only";
import { env } from "./env";

// Durable limiter on Upstash Redis (REST) when configured; per-instance memory otherwise.
const mem = new Map<string, number>();

/** Returns true if `key` may proceed now, and starts a `windowSec` cooldown for it. */
export async function take(key: string, windowSec: number): Promise<boolean> {
  if (env.upstashUrl && env.upstashToken) {
    // SET key 1 NX EX window: succeeds only if the key doesn't exist yet
    const res = await fetch(`${env.upstashUrl}/set/${encodeURIComponent(key)}/1/NX/EX/${windowSec}`, {
      headers: { Authorization: `Bearer ${env.upstashToken}` },
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as { result?: string | null } | null;
    return j?.result === "OK";
  }
  const now = Date.now();
  const until = mem.get(key) ?? 0;
  if (until > now) return false;
  mem.set(key, now + windowSec * 1000);
  return true;
}
