import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("pglite:.data/pglite"),
  REDIS_URL: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** "local": simulated market, chain and news in one process. "live": real vendors, fails fast on missing config. */
  NIGHTSHIFT_SIGNALS_MODE: z.enum(["local", "live"]).default("local"),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  ROBINHOOD_CHAIN_RPC_URL: z.string().optional(),
  ROBINHOOD_CHAIN_ID: z.coerce.number().int().optional(),
  LEDGER_CONTRACT_ADDRESS: z.string().optional(),
  COMMITTER_PRIVATE_KEY: z.string().optional(),
  UNISWAP_QUOTER_ADDRESS: z.string().optional(),
  USDG_ADDRESS: z.string().optional(),
  USDG_DECIMALS: z.coerce.number().int().default(6),
  TOKEN_REGISTRY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Random string you choose; Telegram echoes it on every webhook call. */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Direct Mini App link from BotFather, e.g. https://t.me/<bot>/<app>. */
  TELEGRAM_MINIAPP_LINK: z.string().optional(),
  /** Public origin of this API, for registering the webhook. */
  API_PUBLIC_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:alerts@nightshift-signals.invalid"),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  /** Contents of the .p8 auth key; newlines may be written as \n. */
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_PRODUCTION: z.enum(["true", "false"]).default("false"),
  /** Only needed if Expo push security is enabled for the project. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  X_API_KEY: z.string().optional(),
  X_API_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_SECRET: z.string().optional(),
  API_PORT: z.coerce.number().int().default(8787),
  UNISWAP_CHAIN_SLUG: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  MAX_SLIP_BPS: z.coerce.number().int().optional(),
  MIN_POOL_LIQUIDITY_USDG: z.coerce.number().optional(),
});
export type Env = z.infer<typeof Env>;

/** Variables live mode cannot run without. Values come from official docs and your own accounts, never defaults. */
export const LIVE_REQUIRED = [
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "ROBINHOOD_CHAIN_RPC_URL",
  "ROBINHOOD_CHAIN_ID",
  "LEDGER_CONTRACT_ADDRESS",
  "COMMITTER_PRIVATE_KEY",
  "UNISWAP_QUOTER_ADDRESS",
  "USDG_ADDRESS",
  "TOKEN_REGISTRY",
  "JWT_SECRET",
] as const;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const vars = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ""));
  // Hosts like Railway assign the listening port through PORT; an explicit API_PORT still wins.
  if (!vars.API_PORT && vars.PORT) vars.API_PORT = vars.PORT;
  const env = Env.parse(vars);
  if (env.NIGHTSHIFT_SIGNALS_MODE === "live") {
    const missing = LIVE_REQUIRED.filter((k) => !env[k]);
    if (missing.length) throw new Error(`live mode is missing: ${missing.join(", ")} (see .env.example)`);
    if (env.DATABASE_URL.startsWith("pglite:")) throw new Error("live mode needs a real Postgres DATABASE_URL");
  }
  return env;
}
