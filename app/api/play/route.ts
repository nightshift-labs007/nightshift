import { NextResponse, after, type NextRequest } from "next/server";
import { ensureAiCall } from "@/lib/play/ai";
import { runReminders } from "@/lib/play/remind";
import { settleDue } from "@/lib/play/settle";
import { playNow, playState, playerId } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/**
 * Points game state for this browser: both games' rounds, your picks, stats and recent results.
 * Background work (settling due rounds, taking Nightshift's evening call, reminders) runs after the response, so the
 * page never waits on price sources. With the test clock (non-production only) settling and reminders run first, so
 * a test sees their effect in the same call; the evening call is never taken on a test clock (it needs live prices).
 */
export async function GET(req: NextRequest) {
  const { now, overridden } = playNow(req);
  if (overridden) {
    await settleDue(now, { noLock: true }); // test clock (non-production only): no throttling locks
    await runReminders(now, { noLock: true });
  } else {
    after(async () => {
      await ensureAiCall(now).catch(() => null);
      await settleDue(now).catch(() => null);
      await runReminders(now).catch(() => null);
    });
  }
  return NextResponse.json(await playState(playerId(req), now), { headers: { "Cache-Control": "no-store" } });
}
