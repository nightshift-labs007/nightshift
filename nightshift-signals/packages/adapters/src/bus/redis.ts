import {
  parseEvent,
  runWithRetries,
  type Bus,
  type Envelope,
  type EventType,
  type Handler,
  type SubscribeOptions,
} from "@nightshift-signals/core";
import { Redis } from "ioredis";
import { hostname } from "node:os";

const stream = (type: EventType) => `fp:${type}`;
export const DLQ_STREAM = "fp:dlq";
const SEEN_TTL_S = 7 * 24 * 3600;
/** A message pending this long belongs to a crashed consumer and is reclaimed. */
const RECLAIM_IDLE_MS = 60_000;
const STREAM_MAXLEN = 200_000;

type StreamEntry = [id: string, fields: string[]];

/** One stream per event type, one consumer group per service, idempotent consumers, dead-letter stream. */
export class RedisStreamsBus implements Bus {
  private readonly redis: Redis;
  private readonly readers: Redis[] = [];
  private running = true;
  private loops: Promise<void>[] = [];
  private readonly consumer = `${hostname()}-${process.pid}`;

  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: null });
  }

  async publish(event: Envelope): Promise<void> {
    await this.redis.xadd(stream(event.type), "MAXLEN", "~", STREAM_MAXLEN, "*", "e", JSON.stringify(event));
  }

  subscribe<T extends EventType>(type: T, opts: SubscribeOptions, handler: Handler<T>): void {
    const reader = this.redis.duplicate();
    this.readers.push(reader);
    this.loops.push(this.loop(reader, type, opts, handler as Handler<EventType>));
  }

  async close(): Promise<void> {
    this.running = false;
    for (const r of this.readers) r.disconnect();
    await Promise.allSettled(this.loops);
    await this.redis.quit();
  }

  private async loop(reader: Redis, type: EventType, opts: SubscribeOptions, handler: Handler<EventType>) {
    const key = stream(type);
    try {
      await this.redis.xgroup("CREATE", key, opts.group, "$", "MKSTREAM");
    } catch (e) {
      if (!String(e).includes("BUSYGROUP")) throw e;
    }

    while (this.running) {
      try {
        const claimed = (await this.redis.xautoclaim(key, opts.group, this.consumer, RECLAIM_IDLE_MS, "0-0", "COUNT", 50)) as [
          string,
          StreamEntry[],
        ];
        for (const entry of claimed[1] ?? []) await this.handle(key, entry, opts, handler);

        const res = (await reader.xreadgroup(
          "GROUP", opts.group, this.consumer, "COUNT", 20, "BLOCK", 5000, "STREAMS", key, ">",
        )) as [string, StreamEntry[]][] | null;
        for (const [, entries] of res ?? []) {
          for (const entry of entries) await this.handle(key, entry, opts, handler);
        }
      } catch (e) {
        if (!this.running) return;
        console.error(`[bus] ${opts.group}/${type} read failed`, e);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handle(key: string, [msgId, fields]: StreamEntry, opts: SubscribeOptions, handler: Handler<EventType>) {
    const raw = fields[fields.indexOf("e") + 1];
    let event: Envelope;
    try {
      event = parseEvent(JSON.parse(raw ?? "null"));
    } catch (e) {
      await this.deadLetter(opts.group, raw ?? "", String(e));
      await this.redis.xack(key, opts.group, msgId);
      return;
    }

    const seenKey = `fp:seen:${opts.group}:${event.id}`;
    if (await this.redis.exists(seenKey)) {
      await this.redis.xack(key, opts.group, msgId);
      return;
    }
    const err = await runWithRetries(handler, event, opts);
    if (err) await this.deadLetter(opts.group, JSON.stringify(event), err.message);
    await this.redis.set(seenKey, "1", "EX", SEEN_TTL_S);
    await this.redis.xack(key, opts.group, msgId);
  }

  private async deadLetter(group: string, event: string, error: string) {
    await this.redis.xadd(DLQ_STREAM, "*", "group", group, "e", event, "error", error, "failed_at", new Date().toISOString());
  }
}
