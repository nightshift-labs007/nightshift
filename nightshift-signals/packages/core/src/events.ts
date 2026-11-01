import { ulid } from "ulid";
import { z } from "zod";
import { CATEGORIES, COMMIT_STATUSES, DELIVERY_CHANNELS, PRICE_SOURCES, VOID_REASONS } from "./enums";
import { BasketId, EventId, HeadlineId, SourceId } from "./ids";
import { Bps, Decimal, Hash32, Lang, Timestamp } from "./primitives";

// Payloads carry key fields; Postgres holds the full state. Add fields, never rename.

const ProposedLeg = z.object({ underlying_ticker: z.string(), weight: z.number() });

export const EVENT_PAYLOADS = {
  "headline.ingested": z.object({
    headline_id: HeadlineId,
    source_id: SourceId,
    title: z.string(),
    summary: z.string().nullable(),
    url: z.string(),
    lang: Lang,
    received_at: Timestamp,
  }),
  "event.clustered": z.object({
    event_id: EventId,
    headline_id: HeadlineId,
    headline_ids: z.array(HeadlineId),
    sources_n: z.number().int().min(1),
    is_new: z.boolean(),
  }),
  "event.triaged": z.object({
    event_id: EventId,
    is_market_moving: z.boolean(),
    category: z.enum(CATEGORIES),
    severity: z.number().int().min(0).max(5),
    regions: z.array(z.string()),
    entities: z.array(z.string()),
    corroborated: z.boolean(),
  }),
  "basket.proposed": z.object({
    basket_id: BasketId,
    event_id: EventId,
    thesis: z.string(),
    legs: z.array(ProposedLeg),
    confidence: z.number(),
    created_at: Timestamp,
    model_version: z.string(),
    prompt_version: z.string(),
    analog_event_ids: z.array(EventId),
    why_chain: z.array(z.string()).default([]),
  }),
  "basket.sized": z.object({
    basket_id: BasketId,
    event_id: EventId,
    voided: z.boolean(),
    void_reason: z.enum(VOID_REASONS).nullable(),
    max_leg_slip_bps: Bps.nullable(),
    dropped: z.array(z.object({ underlying_ticker: z.string(), reason: z.string() })),
  }),
  "basket.committed": z.object({
    basket_id: BasketId,
    hash: Hash32,
    tx_hash: Hash32.nullable(),
    status: z.enum(COMMIT_STATUSES),
    block_time: Timestamp.nullable(),
  }),
  "basket.published": z.object({
    basket_id: BasketId,
    event_id: EventId,
    channels: z.array(z.enum(DELIVERY_CHANNELS)),
    sent_at: Timestamp,
  }),
  "price.tick": z.object({
    symbol: z.string(),
    px: Decimal,
    src: z.enum(PRICE_SOURCES),
    ts: Timestamp,
  }),
  "alert.drift": z.object({
    symbol: z.string(),
    px: Decimal,
    fv: Decimal,
    gap_bps: Bps,
    frozen: z.boolean(),
    ts: Timestamp,
  }),
  "basket.graded": z.object({
    basket_id: BasketId,
    ret_pct: Decimal,
    vs_spy_pct: Decimal,
    hit: z.boolean(),
    graded_at: Timestamp,
  }),
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[];
export type Payload<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

export const ENVELOPE_VERSION = 1;

export interface Envelope<T extends EventType = EventType> {
  id: string;
  type: T;
  version: number;
  occurred_at: string;
  producer: string;
  /** The event_id (or headline_id, before clustering) that started the chain. */
  correlation_id: string;
  payload: Payload<T>;
}

export const EnvelopeBase = z.object({
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  version: z.number().int().positive(),
  occurred_at: Timestamp,
  producer: z.string().min(1),
  correlation_id: z.string().min(1),
  payload: z.unknown(),
});

export function makeEvent<T extends EventType>(
  type: T,
  payload: z.input<(typeof EVENT_PAYLOADS)[T]>,
  meta: { producer: string; correlation_id: string; now?: Date },
): Envelope<T> {
  const now = meta.now ?? new Date();
  return {
    id: ulid(now.getTime()),
    type,
    version: ENVELOPE_VERSION,
    occurred_at: now.toISOString(),
    producer: meta.producer,
    correlation_id: meta.correlation_id,
    payload: EVENT_PAYLOADS[type].parse(payload) as Payload<T>,
  };
}

/** Validates an envelope read off the wire, including its payload. */
export function parseEvent(raw: unknown): Envelope {
  const base = EnvelopeBase.parse(raw);
  const payload = EVENT_PAYLOADS[base.type].parse(base.payload);
  return { ...base, payload } as Envelope;
}
