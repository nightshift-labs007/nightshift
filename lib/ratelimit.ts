import "server-only";
import { kvEnabled, kvIncrWindow, kvSetNX } from "./kv";

// Durable limiter on the shared store (Postgres, or Upstash) when configured; per-instance memory otherwise.
const mem = new Map<string, number>();

/** Returns true if `key` may proceed now, and starts a `windowSec` cooldown for it. */
export async function take(key: string, windowSec: number): Promise<boolean> {
  if (kvEnabled()) return kvSetNX(`rl:${key}`, "1", windowSec).catch(() => false); // store down: hold the cooldown, as before
  const now = Date.now();
  const until = mem.get(key) ?? 0;
  if (until > now) return false;
  mem.set(key, now + windowSec * 1000);
  return true;
}

const windows = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window counter: up to `max` calls per `windowSec` for `key`. Durable when the store is configured. */
export async function allow(key: string, max: number, windowSec: number): Promise<{ ok: boolean; remaining: number; resetSec: number }> {
  if (kvEnabled()) {
    const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = await kvIncrWindow(k, windowSec).catch(() => 0);
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
