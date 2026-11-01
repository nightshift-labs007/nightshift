// Every enum lives here once. packages/db builds its pgEnums from these arrays.

export const CATEGORIES = [
  "geopolitics_energy",
  "conflict_defense",
  "semis_export",
  "monetary_policy",
  "trade_tariffs",
  "china_macro",
  "crypto_regulation",
  "health_policy",
  "earnings_megacap",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Events at or above this severity are mapped to baskets. */
export const MAP_MIN_SEVERITY = 3;
export const MAX_SEVERITY = 5;

export const DIRECTIONS = ["long", "short"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const HORIZONS = ["next_open", "next_close", "1w"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const BASKET_STATUSES = ["draft", "published", "graded", "void"] as const;
export type BasketStatus = (typeof BASKET_STATUSES)[number];

export const VOID_REASONS = [
  "illiquid", // fewer than 2 legs survived sizing
  "token_halted", // a leg's token was halted at the open
  "pool_paused", // a leg's pool was paused at the open
  "stale", // mapping finished after the 5-minute cutoff
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

export const SOURCE_KINDS = ["rss", "x", "wire", "gdelt", "gov"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const COMMIT_STATUSES = ["pending", "confirmed"] as const;
export type CommitStatus = (typeof COMMIT_STATUSES)[number];

export const DELIVERY_CHANNELS = ["ws", "push", "telegram", "x", "email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const PRICE_SOURCES = ["dex", "futures", "spot", "chainlink", "official_open"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const USER_TIERS = ["free", "pro"] as const;
export type UserTier = (typeof USER_TIERS)[number];

export const VOTES = ["follow", "fade"] as const;
export type Vote = (typeof VOTES)[number];

/** Locales with translated UI and theses. */
export const LOCALES = ["en", "hi", "es"] as const;
export type Locale = (typeof LOCALES)[number];
