import { NextResponse, type NextRequest } from "next/server";
import { alert } from "@/lib/alert";
import { authorized } from "@/lib/env";
import { getHealth } from "@/lib/health";
import { pushPrices, runGuardian } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every few minutes by an external scheduler (e.g. cron-job.org, with an "Authorization: Bearer <CRON_SECRET>"
// header), because Vercel's free plan only allows daily crons. Pushes Oracle prices on-chain and runs the Guardian.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
  // alert at most about once an hour (the first run in each hour) while something is wrong
  try {
    const h = await getHealth();
    out.health = { ok: h.ok, issues: h.issues };
    if (!h.ok && new Date().getUTCMinutes() < 6) await alert((h.issues as string[]).join("; "));
  } catch (e) {
    out.health = { error: String(e).slice(0, 200) };
  }
  return NextResponse.json(out);
}
