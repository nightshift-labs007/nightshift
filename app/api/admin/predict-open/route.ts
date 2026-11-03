import { NextResponse, type NextRequest } from "next/server";
import { openRoundsNow } from "@/lib/chain/predictions";
import { authorized } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Team-only (Bearer CRON_SECRET): opens the next session's "Call the Open" rounds now, without waiting for the 20:00 ET
 * evening call. Same rules otherwise: the market must be closed, betting closes at 09:00 ET, and the call is locked on
 * Algorand first. Does nothing if the rounds already exist.
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://nightshift.buzz/api/admin/predict-open
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await openRoundsNow());
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
