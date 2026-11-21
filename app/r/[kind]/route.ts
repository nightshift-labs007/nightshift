import { NextResponse, type NextRequest } from "next/server";
import { track } from "@/lib/ops";
import { playerId } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/**
 * Links in reminder emails go through here (/r/open, /r/lock, /r/results, …): counts a "reminder_click" and sends the
 * player to the game. We count clicks, not opens: open-tracking pixels are unreliable and more invasive.
 */
export async function GET(req: NextRequest) {
  await track("reminder_click", playerId(req));
  return NextResponse.redirect(new URL("/app#predict", req.url), 302);
}
