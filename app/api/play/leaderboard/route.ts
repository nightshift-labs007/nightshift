import { NextResponse, type NextRequest } from "next/server";
import { leaderboard } from "@/lib/play/leaderboard";
import { playNow } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/** Top players by points this week and all time (signed-in players, nicknames only). */
export async function GET(req: NextRequest) {
  const { now, overridden } = playNow(req);
  return NextResponse.json(await leaderboard(now, overridden), { headers: { "Cache-Control": "no-store" } });
}
