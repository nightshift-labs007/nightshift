import { NextResponse, after, type NextRequest } from "next/server";
import { settleDue } from "@/lib/play/settle";
import { playNow, playState, playerId } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/**
 * Points game state for this browser: the round taking picks, your picks, stats and recent results.
 * Settling due rounds happens after the response (it calls Yahoo), so the page never waits on it; with the
 * test clock (non-production only) it runs first, so a test sees the settled result in the same call.
 */
export async function GET(req: NextRequest) {
  const { now, overridden } = playNow(req);
  if (overridden) await settleDue(now);
  else after(() => settleDue(now).catch(() => {}));
  return NextResponse.json(await playState(playerId(req), now), { headers: { "Cache-Control": "no-store" } });
}
