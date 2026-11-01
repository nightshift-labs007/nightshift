import { z } from "zod";
import { CATEGORIES, DELIVERY_CHANNELS, MAX_SEVERITY, USER_TIERS } from "../enums";
import { BasketId, PositionId, TriggerId, UserId } from "../ids";
import { Address, Country, Decimal, Hash32, Lang, Timestamp } from "../primitives";

export const User = z
  .object({
    id: UserId,
    wallet: Address.nullable(),
    email: z.email().nullable(),
    telegram_id: z.number().int().positive().nullable().optional(),
    lang: Lang,
    country: Country.nullable(),
    tier: z.enum(USER_TIERS),
    created_at: Timestamp,
  })
  .refine((u) => u.wallet !== null || u.email !== null || (u.telegram_id ?? null) !== null, { message: "user needs a wallet, an email or a Telegram id" });
export type User = z.infer<typeof User>;

/** What a plain-English trigger compiles to. Evaluated on every event.triaged. */
export const TriggerRule = z.object({
  categories: z.array(z.enum(CATEGORIES)),
  min_severity: z.number().int().min(0).max(MAX_SEVERITY),
  entities: z.array(z.string().min(1).max(120)),
  regions: z.array(z.string().min(1).max(64)),
});
export type TriggerRule = z.infer<typeof TriggerRule>;

export const Trigger = z.object({
  id: TriggerId,
  user_id: UserId,
  nl_text: z.string().min(1).max(500),
  compiled_rule: TriggerRule,
  channels: z.array(z.enum(DELIVERY_CHANNELS)).min(1),
  active: z.boolean(),
  created_at: Timestamp,
});
export type Trigger = z.infer<typeof Trigger>;

/** Quote logged when the user tapped a leg's trade link: the paper entry. */
export const PositionEntry = z.object({
  token_symbol: z.string().min(1).max(32),
  quote_price: Decimal,
  quote_size_usdg: Decimal,
  clicked_at: Timestamp,
});
export type PositionEntry = z.infer<typeof PositionEntry>;

export const Position = z.object({
  id: PositionId,
  user_id: UserId,
  basket_id: BasketId,
  size_usdg: Decimal,
  entries: z.array(PositionEntry),
  tx_hashes: z.array(Hash32),
  created_at: Timestamp,
});
export type Position = z.infer<typeof Position>;

/** Append-only audit row: proves latency and that nobody received a basket early. */
export const Delivery = z.object({
  basket_id: BasketId,
  channel: z.enum(DELIVERY_CHANNELS),
  user_id: UserId.nullable(),
  sent_at: Timestamp,
  latency_ms: z.number().int().nonnegative(),
});
export type Delivery = z.infer<typeof Delivery>;
