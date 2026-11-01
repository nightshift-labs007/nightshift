import { ulid } from "ulid";
import { z } from "zod";

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";

export const ID_PREFIXES = {
  source: "src",
  headline: "hl",
  event: "evt",
  user: "usr",
  trigger: "trg",
  position: "pos",
  push: "psh",
  liveActivity: "lac",
} as const;
type Entity = keyof typeof ID_PREFIXES;

/** Prefixed ULID, e.g. `evt_01JB8...`. Sortable by creation time. */
export function newId(entity: Entity, now = Date.now()): string {
  return `${ID_PREFIXES[entity]}_${ulid(now)}`;
}

export function idSchema(entity: Entity) {
  return z.string().regex(new RegExp(`^${ID_PREFIXES[entity]}_${ULID}$`), `expected ${ID_PREFIXES[entity]}_<ULID>`);
}

export const SourceId = idSchema("source");
export const HeadlineId = idSchema("headline");
export const EventId = idSchema("event");
export const UserId = idSchema("user");
export const TriggerId = idSchema("trigger");
export const PositionId = idSchema("position");

/** `bkt_YYYYMMDD_HHMM_suffix`; the timestamp is UTC, like all storage. */
export const BasketId = z.string().regex(/^bkt_\d{8}_\d{4}_[a-z0-9]{1,16}$/, "expected bkt_YYYYMMDD_HHMM_suffix");

export function newBasketId(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
  // Last 8 chars of a ULID are random; lowercase keeps ids URL-friendly.
  const suffix = ulid(at.getTime()).slice(-8).toLowerCase();
  return `bkt_${date}_${time}_${suffix}`;
}
