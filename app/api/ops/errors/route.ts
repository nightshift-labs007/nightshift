import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/env";
import { recentErrors } from "@/lib/ops";
import { testMode } from "@/lib/play/testmode";

export const dynamic = "force-dynamic";

/** The last 50 server and browser errors (scrubbed). Team only: "Authorization: Bearer <CRON_SECRET>" (open in test mode). */
export async function GET(req: NextRequest) {
  if (!authorized(req) && !testMode()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ errors: await recentErrors() }, { headers: { "Cache-Control": "no-store" } });
}
