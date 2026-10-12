import "server-only";

/**
 * Every setting the server reads, in one place. Nothing is strictly required: each feature turns
 * itself off when its setting is missing, and /api/health and the UI say so plainly.
 */
const v = (k: string) => (process.env[k] ?? "").trim();

export const env = {
  cronSecret: v("CRON_SECRET"),
  algorandMnemonic: v("ALGORAND_MNEMONIC"),
  updaterKey: v("ORACLE_UPDATER_PRIVATE_KEY"),
  keeperKey: v("KEEPER_PRIVATE_KEY"),
  faucetKey: v("FAUCET_PRIVATE_KEY"),
  anthropicKey: v("ANTHROPIC_API_KEY"),
  twelveDataKey: v("TWELVEDATA_API_KEY"),
  upstashUrl: v("UPSTASH_REDIS_REST_URL"),
  upstashToken: v("UPSTASH_REDIS_REST_TOKEN"),
  turnstileSecret: v("TURNSTILE_SECRET_KEY"),
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
    ledger: env.algorandMnemonic.split(/\s+/).length === 25,
    oracleUpdater: looksLikeKey(env.updaterKey),
    guardianKeeper: looksLikeKey(env.keeperKey),
    faucet: looksLikeKey(env.faucetKey),
    newsAgent: env.anthropicKey.length > 0,
    priceFallback: env.twelveDataKey.length > 0,
    durableRateLimit: !!(env.upstashUrl && env.upstashToken),
    captcha: !!(env.turnstileSecret && env.turnstileSite),
    alerts: !!(env.telegramToken && env.telegramChat),
    walletConnect: env.walletConnect.length > 0,
    xAgent: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].every((k) => v(k).length > 0),
  };
}

/** Settings that are present but malformed: these are bugs, not just "not configured". */
export function configProblems(): string[] {
  const p: string[] = [];
  for (const [name, val] of [["ORACLE_UPDATER_PRIVATE_KEY", env.updaterKey], ["KEEPER_PRIVATE_KEY", env.keeperKey], ["FAUCET_PRIVATE_KEY", env.faucetKey]] as const)
    if (val && !looksLikeKey(val)) p.push(`${name} is not a 0x-prefixed 32-byte hex key`);
  if (env.algorandMnemonic && env.algorandMnemonic.split(/\s+/).length !== 25) p.push("ALGORAND_MNEMONIC should have 25 words");
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
