import "server-only";

/**
 * Every setting the server reads, in one place. Nothing is strictly required: each feature turns
 * itself off when its setting is missing, and /api/health and the UI say so plainly.
 */
const v = (k: string) => (process.env[k] ?? "").trim();
// values pasted into a dashboard with their .env quotes ("…" or '…') would otherwise reach the API with the quotes in
const unquoted = (k: string) => v(k).replace(/^(["'])(.*)\1$/s, "$2").trim();

// Resend only sends from a domain verified in the account (nightshift.buzz). A personal mailbox (gmail.com, outlook.com…)
// can never be verified, so a RESEND_FROM like that falls back to the verified Nightshift sender.
const DEFAULT_SENDER = "Nightshift <hello@nightshift.buzz>";
const PERSONAL_MAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|proton|protonmail|aol)\.[a-z.]+>?$/i;
const senderFrom = (raw: string) => (raw && PERSONAL_MAIL.test(raw) ? DEFAULT_SENDER : raw);

export const env = {
  cronSecret: v("CRON_SECRET"),
  updaterKey: v("ORACLE_UPDATER_PRIVATE_KEY"),
  keeperKey: v("KEEPER_PRIVATE_KEY"),
  faucetKey: v("FAUCET_PRIVATE_KEY"),
  anthropicKey: v("ANTHROPIC_API_KEY"),
  twelveDataKey: v("TWELVEDATA_API_KEY"),
  // Vercel's Upstash integration may name these KV_REST_API_*: accept either
  upstashUrl: v("UPSTASH_REDIS_REST_URL") || v("KV_REST_API_URL"),
  upstashToken: v("UPSTASH_REDIS_REST_TOKEN") || v("KV_REST_API_TOKEN"),
  turnstileSecret: v("TURNSTILE_SECRET_KEY"),
  resendKey: unquoted("RESEND_API_KEY"),
  // a sender on a domain verified in Resend, e.g. "Nightshift <hello@nightshift.buzz>". Setting both switches on invite-only
  // sign-up (onboarding@resend.dev works for tests but only delivers to the Resend account's own email)
  resendFrom: senderFrom(unquoted("RESEND_FROM")),
  // Nightshift wallets (Privy): email login that creates a wallet for each user. The app id is public.
  privyAppId: v("NEXT_PUBLIC_PRIVY_APP_ID") || "cmw2jfbf400020gi962dylmzx",
  privySecret: unquoted("PRIVY_APP_SECRET"),
  telegramToken: v("TELEGRAM_BOT_TOKEN"),
  telegramChat: v("TELEGRAM_CHAT_ID"),
  walletConnect: v("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"),
  turnstileSite: v("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
};

const looksLikeKey = (k: string) => /^0x[0-9a-fA-F]{64}$/.test(k);

/** What is configured, as booleans only (never values). */
export function configStatus() {
  return {
    cron: env.cronSecret.length >= 16,
    ledger: looksLikeKey(env.updaterKey), // the public record on Base is written by the updater wallet
    oracleUpdater: looksLikeKey(env.updaterKey),
    guardianKeeper: looksLikeKey(env.keeperKey),
    faucet: looksLikeKey(env.faucetKey),
    newsAgent: env.anthropicKey.length > 0,
    priceFallback: env.twelveDataKey.length > 0,
    durableRateLimit: !!(env.upstashUrl && env.upstashToken),
    profiles: !!(env.upstashUrl && env.upstashToken && env.cronSecret.length >= 16),
    email: !!(env.resendKey && env.resendFrom),
    captcha: !!(env.turnstileSecret && env.turnstileSite),
    alerts: !!(env.telegramToken && env.telegramChat),
    walletConnect: env.walletConnect.length > 0,
  };
}

/** Settings that are present but malformed: these are bugs, not just "not configured". */
export function configProblems(): string[] {
  const p: string[] = [];
  for (const [name, val] of [["ORACLE_UPDATER_PRIVATE_KEY", env.updaterKey], ["KEEPER_PRIVATE_KEY", env.keeperKey], ["FAUCET_PRIVATE_KEY", env.faucetKey]] as const)
    if (val && !looksLikeKey(val)) p.push(`${name} is not a 0x-prefixed 32-byte hex key`);
  if (env.cronSecret && env.cronSecret.length < 16) p.push("CRON_SECRET should be at least 16 characters");
  if (!!env.upstashUrl !== !!env.upstashToken) p.push("set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  if (!!env.turnstileSecret !== !!env.turnstileSite) p.push("set both TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  return p;
}

/** Bearer-header auth for scheduled jobs (never a URL parameter: URLs end up in logs). */
export function authorized(req: Request): boolean {
  if (!env.cronSecret) return false;
  return req.headers.get("authorization") === `Bearer ${env.cronSecret}`;
}
