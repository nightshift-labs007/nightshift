import { NextResponse, type NextRequest } from "next/server";
import { alert } from "@/lib/alert";
import { authorized } from "@/lib/env";
import { runJob } from "@/lib/ops";
import { getHealth } from "@/lib/health";
import { pushPrices, runGuardian, runStack } from "@/lib/chain/keeper";
import { runPredictions } from "@/lib/chain/predictions";
import { getOracleSnapshot } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 10 minutes by an outside scheduler (cron-job.org, with "Authorization: Bearer <CRON_SECRET>"; Vercel's free
// plan only allows daily crons; see docs/DEPLOY.md). Pushes Oracle prices on Base, then runs the Guardian, due Stack plans and
// the "Call the Open" prediction rounds. The points games run from /api/jobs/play. Its heartbeat shows at /api/ops/health.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runJob("keeper", true, () => keeperRun()));
}

async function keeperRun() {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  try {
    out.prices = await pushPrices();
  } catch (e) {
    out.prices = { error: String(e).slice(0, 300) };
  }
  try {
    out.guardian = await runGuardian();
  } catch (e) {
    out.guardian = { error: String(e).slice(0, 300) };
  }
  try {
    out.stack = await runStack();
  } catch (e) {
    out.stack = { error: String(e).slice(0, 300) };
  }
  try {
    out.predictions = await runPredictions(); // "Call the Open": member sync, evening rounds, settlement
  } catch (e) {
    out.predictions = { error: String(e).slice(0, 300) };
  }
  // alert at most about once an hour (the first run in each hour) while something is wrong
  try {
    const h = await getHealth();
    out.health = { ok: h.ok, issues: h.issues };
    if (!h.ok && new Date().getUTCMinutes() < 6) await alert((h.issues as string[]).join("; "));
  } catch (e) {
    out.health = { error: String(e).slice(0, 200) };
  }
  return out;
}
