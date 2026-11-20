import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/env";
import { runJob } from "@/lib/ops";
import { ensureAiCall } from "@/lib/play/ai";
import { runReminders } from "@/lib/play/remind";
import { settleDue } from "@/lib/play/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The points-game jobs, for the scheduler (every 5 minutes, "Authorization: Bearer <CRON_SECRET>"):
 * take Nightshift's evening call (Beat the AI), settle rounds after the open, send reminder emails.
 * Each records a heartbeat, visible at /api/ops/health. Page loads also run them (unscheduled), as a backstop.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = Date.now();
  const aiCall = await runJob("aiCall", true, async () => ({ taken: !!(await ensureAiCall(now)) }));
  const settle = await runJob("settle", true, () => settleDue(now));
  const reminders = await runJob("reminders", true, () => runReminders(now));
  return NextResponse.json({ at: new Date(now).toISOString(), aiCall, settle, reminders });
}
