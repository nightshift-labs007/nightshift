import "server-only";
import net from "node:net";
import tls from "node:tls";
import { encode, parse, RedisError, type Reply } from "./resp";

// A minimal client for a plain Redis server over TCP (e.g. Railway's Redis, via REDIS_URL), with no new dependencies.
// One persistent connection; replies come back in order, so pending commands are a simple queue. Reconnects on demand.

type Pending = { resolve: (v: Reply) => void; reject: (e: Error) => void };
let sock: net.Socket | null = null;
let ready: Promise<net.Socket> | null = null;
let buf: Buffer = Buffer.alloc(0);
let queue: Pending[] = [];

function drop(err: Error) {
  sock?.destroy();
  sock = null;
  ready = null;
  buf = Buffer.alloc(0);
  const q = queue;
  queue = [];
  for (const p of q) p.reject(err);
}

function connect(url: string): Promise<net.Socket> {
  if (ready) return ready;
  const u = new URL(url);
  const opts = { host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port || 6379) };
  ready = new Promise<net.Socket>((resolve, reject) => {
    const s = u.protocol === "rediss:" ? tls.connect({ ...opts, servername: opts.host }) : net.connect(opts);
    s.setNoDelay(true);
    s.setKeepAlive(true, 30_000);
    const onFail = (e: Error) => { reject(e); drop(e); };
    s.once("error", onFail);
    s.on("close", () => drop(new Error("redis: connection closed")));
    s.on("data", (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let at = 0;
      for (;;) {
        const r = parse(buf, at);
        if (!r) break;
        at = r.next;
        const p = queue.shift();
        if (p) r.value instanceof RedisError ? p.reject(r.value) : p.resolve(r.value);
      }
      buf = at >= buf.length ? Buffer.alloc(0) : buf.subarray(at);
    });
    s.once(u.protocol === "rediss:" ? "secureConnect" : "connect", async () => {
      s.off("error", onFail);
      s.on("error", (e) => drop(e));
      sock = s;
      try {
        const user = decodeURIComponent(u.username || "");
        const pass = decodeURIComponent(u.password || "");
        if (pass) await send(s, user ? ["AUTH", user, pass] : ["AUTH", pass]);
        const db = u.pathname.replace("/", "");
        if (db && db !== "0") await send(s, ["SELECT", db]);
        resolve(s);
      } catch (e) {
        reject(e as Error);
        drop(e as Error);
      }
    });
  });
  return ready;
}

function send(s: net.Socket, args: (string | number)[]): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    queue.push({ resolve, reject });
    s.write(encode(args));
  });
}

/** Runs one command; rejects on a Redis error, a dropped connection, or after `timeoutMs`. */
export async function redisCmd<T>(url: string, args: (string | number)[], timeoutMs = 6000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error("redis: timeout");
      reject(e);
      drop(e); // replies would be out of step with the queue after a lost one: start a fresh connection
    }, timeoutMs);
  });
  try {
    const s = await Promise.race([connect(url), timeout]);
    return (await Promise.race([send(s, args), timeout])) as T;
  } finally {
    clearTimeout(timer);
  }
}
