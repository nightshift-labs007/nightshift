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

const windows = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window counter: up to `max` calls per `windowSec` for `key`. Durable on Upstash when configured. */
export async function allow(key: string, max: number, windowSec: number): Promise<{ ok: boolean; remaining: number; resetSec: number }> {
  if (env.upstashUrl && env.upstashToken) {
    const k = `${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const res = await fetch(`${env.upstashUrl}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.upstashToken}` },
      body: JSON.stringify([["INCR", k], ["EXPIRE", k, String(windowSec)]]),
      cache: "no-store",
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { result: number }[] | null;
    const n = j?.[0]?.result ?? 0;
    return { ok: n <= max, remaining: Math.max(0, max - n), resetSec: windowSec - (Math.floor(Date.now() / 1000) % windowSec) };
  }
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, remaining: max - 1, resetSec: windowSec };
  }
  w.count++;
  return { ok: w.count <= max, remaining: Math.max(0, max - w.count), resetSec: Math.ceil((w.resetAt - now) / 1000) };
}
