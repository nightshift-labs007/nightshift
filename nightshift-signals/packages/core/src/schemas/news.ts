import { z } from "zod";
import { CATEGORIES, MAX_SEVERITY, SOURCE_KINDS } from "../enums";
import { EventId, HeadlineId, SourceId } from "../ids";
import { Lang, Timestamp } from "../primitives";

export const Source = z.object({
  id: SourceId,
  kind: z.enum(SOURCE_KINDS),
  name: z.string().min(1).max(120),
  url: z.url(),
  trust_weight: z.number().min(0).max(1),
  active: z.boolean(),
});
export type Source = z.infer<typeof Source>;

/** One normalized headline. We store title, short summary and link only, never article text. */
export const Headline = z.object({
  id: HeadlineId,
  source_id: SourceId,
  source_item_id: z.string().min(1).max(512),
  url: z.url(),
  title: z.string().min(1).max(500),
  summary: z.string().max(1000).nullable(),
  lang: Lang,
  published_at: Timestamp.nullable(),
  received_at: Timestamp,
  event_id: EventId.nullable(),
});
export type Headline = z.infer<typeof Headline>;

/** Output of the triage model (classify_headline tool). */
export const Triage = z.object({
  is_market_moving: z.boolean(),
  category: z.enum(CATEGORIES),
  regions: z.array(z.string().min(1).max(64)).max(10),
  severity: z.number().int().min(0).max(MAX_SEVERITY),
  entities: z.array(z.string().min(1).max(120)).max(20),
  reason: z.string().max(160),
});
export type Triage = z.infer<typeof Triage>;

/** A cluster of headlines about one story. Triage fields are null until triaged. */
export const Event = z.object({
  id: EventId,
  title: z.string().min(1).max(500),
  sources_n: z.number().int().min(1),
  headline_ids: z.array(HeadlineId).min(1),
  first_seen_at: Timestamp,
  triage: Triage.nullable(),
  triaged_at: Timestamp.nullable(),
});
export type Event = z.infer<typeof Event>;
