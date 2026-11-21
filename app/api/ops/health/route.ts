import { NextResponse, type NextRequest } from "next/server";
import { configStatus, env } from "@/lib/env";
import { kvPing } from "@/lib/kv";
import { jobsStatus } from "@/lib/ops";
import { playSecret } from "@/lib/play/mail";
import { storeKind } from "@/lib/play/store";
import { testMode } from "@/lib/play/testmode";
import { priceBackoff, priceProvider } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * Go-live health for the points games, for an uptime monitor: 200 when ready, 503 when not (?soft=1 always 200).
 * Booleans and timestamps only: never values of settings, emails or ids.
 */
export async function GET(req: NextRequest) {
  const now = Date.now();
  const [jobs, redisUp] = await Promise.all([jobsStatus(now), kvPing()]);
  const cfg = configStatus();
  const secret = playSecret();
  const checks = {
    redis: storeKind() === "redis" && redisUp, // a real PING round trip; false if not configured (memory) or unreachable
    email: cfg.email, // RESEND_API_KEY + RESEND_FROM
    playSecret: !!secret && secret !== "nightshift-dev-only-play-secret", // PLAY_SECRET or CRON_SECRET
    cronSecret: cfg.cron,
    captcha: cfg.captcha, // optional
    schedulerPlay: !jobs.settle.stale && !jobs.reminders.stale && !jobs.aiCall.stale,
    schedulerKeeper: !jobs.keeper.stale, // only required when the on-chain keeper keys are set
  };
  const keeperNeeded = cfg.oracleUpdater || cfg.guardianKeeper;
  const ready = checks.redis && checks.email && checks.playSecret && checks.cronSecret && checks.schedulerPlay && (!keeperNeeded || checks.schedulerKeeper);
  const body = {
    ready,
    at: new Date(now).toISOString(),
    checks,
    keeperNeeded,
    testMode: testMode(), // must be false in production
    store: storeKind(),
    prices: { provider: priceProvider().name, coolingDown: priceBackoff() },
    jobs,
    upstash: !!(env.upstashUrl && env.upstashToken),
  };
  const soft = req.nextUrl.searchParams.get("soft") === "1";
  return NextResponse.json(body, { status: ready || soft ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
