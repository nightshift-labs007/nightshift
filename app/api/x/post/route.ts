import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/env";
import { SLOTS, runSlot, type Slot } from "@/lib/xagent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by .github/workflows/x-agent.yml with "Authorization: Bearer <CRON_SECRET>".
// ?slot=preopen|graded|weekend|fact; ?force=1 ignores the time window (for a manual test post); ?dry=1 never posts.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const slot = q.get("slot") as Slot;
  if (!(slot in SLOTS)) return NextResponse.json({ error: `slot must be one of ${Object.keys(SLOTS).join(", ")}` }, { status: 400 });
  try {
    return NextResponse.json(await runSlot(slot, { force: q.get("force") === "1", dryRun: q.get("dry") === "1" }));
  } catch (e) {
    return NextResponse.json({ slot, status: "error", error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 502 });
  }
}
