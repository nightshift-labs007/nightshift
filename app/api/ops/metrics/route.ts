import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/env";
import { metrics } from "@/lib/ops";
import { testMode } from "@/lib/play/testmode";

export const dynamic = "force-dynamic";

/**
 * Beta metrics: daily event counts (visits, picks, sign-ups, shares, reminders sent and clicked), active players,
 * picks per player, and day-1 / day-7 return by first-seen cohort. Team only: Bearer CRON_SECRET (open in test mode).
 * ?days=1..60 (default 14).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req) && !testMode()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 14));
  return NextResponse.json(await metrics(days), { headers: { "Cache-Control": "no-store" } });
}
