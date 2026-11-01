import type { QuoteSource, RateLimiter } from "@nightshift-signals/adapters";
import type { JsonModel } from "@nightshift-signals/ai";
import type { Bus, PriceCache } from "@nightshift-signals/core";
import type { Db, FairValueService } from "@nightshift-signals/db";

export interface ApiContext {
  db: Db;
  bus: Bus;
  prices: PriceCache;
  fairValue: FairValueService;
  quotes: QuoteSource;
  model: JsonModel;
  rateLimiter: RateLimiter;
  mode: "local" | "live";
  jwtSecret: Uint8Array;
  maxSlipBps: number;
  /** Telegram bot for Mini App sign-in and the webhook; null when not configured. */
  telegram: { botToken: string; webhookSecret: string; appUrl: string } | null;
  /** Public VAPID key for Web Push; null when push is not configured. */
  vapidPublicKey: string | null;
  /** Uniswap web app slug for Robinhood Chain and the USDG address; null until confirmed from docs. */
  links: { chainSlug: string | null; usdgAddress: string | null };
  now: () => Date;
}

export type Env = { Variables: { userId: string } };
