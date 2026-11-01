import type { Envelope, EventType } from "./events";

export type Handler<T extends EventType> = (event: Envelope<T>) => Promise<void>;

export interface SubscribeOptions {
  /** Consumer group: each event is handled once per group. One group per service. */
  group: string;
  /** Attempts before the event goes to the dead-letter stream. */
  maxAttempts?: number;
  /** Base backoff; doubles after each failed attempt. */
  backoffMs?: number;
}

export interface DeadLetter {
  group: string;
  event: Envelope;
  error: string;
  failed_at: string;
}

/** Services talk only through this. Redis Streams in production, in-memory for tests and replay. */
export interface Bus {
  publish(event: Envelope): Promise<void>;
  subscribe<T extends EventType>(type: T, opts: SubscribeOptions, handler: Handler<T>): void;
  close(): Promise<void>;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs a handler with retries and exponential backoff. Returns the last error, or null on success. */
export async function runWithRetries<T extends EventType>(
  handler: Handler<T>,
  event: Envelope<T>,
  opts: SubscribeOptions,
): Promise<Error | null> {
  const attempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await handler(event);
      return null;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
      if (i < attempts - 1 && backoff > 0) await sleep(backoff * 2 ** i);
    }
  }
  return last;
}

interface Subscription {
  opts: SubscribeOptions;
  handler: Handler<EventType>;
  queue: Envelope[];
  running: boolean;
  seen: Set<string>;
}

/**
 * Same semantics as the Redis bus (per-group delivery, ordered per group, idempotent by event id,
 * retries then dead-letter) without a server. Used by tests, replay and `pnpm dev:local`.
 */
export class InMemoryBus implements Bus {
  readonly deadLetters: DeadLetter[] = [];
  readonly published: Envelope[] = [];
  private subs = new Map<EventType, Map<string, Subscription>>();
  private inflight = new Set<Promise<void>>();
  private closed = false;

  constructor(private defaults: Partial<SubscribeOptions> = {}) {}

  async publish(event: Envelope): Promise<void> {
    if (this.closed) throw new Error("bus is closed");
    this.published.push(event);
    for (const sub of this.subs.get(event.type)?.values() ?? []) {
      sub.queue.push(event);
      this.drain(sub);
    }
  }

  subscribe<T extends EventType>(type: T, opts: SubscribeOptions, handler: Handler<T>): void {
    const groups = this.subs.get(type) ?? new Map<string, Subscription>();
    if (groups.has(opts.group)) throw new Error(`group ${opts.group} already subscribed to ${type}`);
    groups.set(opts.group, {
      opts: { ...this.defaults, ...opts },
      handler: handler as Handler<EventType>,
      queue: [],
      running: false,
      seen: new Set(),
    });
    this.subs.set(type, groups);
  }

  /** Resolves when every queue is empty, including events published by handlers along the way. */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  async close(): Promise<void> {
    await this.idle();
    this.closed = true;
  }

  private drain(sub: Subscription) {
    if (sub.running) return;
    sub.running = true;
    const p = (async () => {
      while (sub.queue.length > 0) {
        const event = sub.queue.shift()!;
        if (sub.seen.has(event.id)) continue;
        const err = await runWithRetries(sub.handler, event, sub.opts);
        if (err) {
          this.deadLetters.push({ group: sub.opts.group, event, error: err.message, failed_at: new Date().toISOString() });
        }
        sub.seen.add(event.id);
      }
      sub.running = false;
    })();
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }
}
