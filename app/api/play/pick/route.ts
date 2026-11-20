import { NextResponse, type NextRequest } from "next/server";
import { PLAY_TICKERS, isSide } from "@/lib/play-rules";
import { setPick } from "@/lib/play/store";
import { newPlayerId, playNow, playState, playerId, setPlayerCookie } from "@/lib/play/state";
import { allow } from "@/lib/ratelimit";
import { currentPlayRound } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Make or change a pick for the round taking picks now. Body: { date, ticker, side: "up" | "down" }.
 * `date` is the round the page showed; if that round has locked in the meantime the pick is refused rather than
 * silently moved to the next round. No wallet or account: the first pick sets an anonymous cookie.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await allow(`play:pick:${ip}`, 60, 60)).ok) return NextResponse.json({ error: "Too many picks. Try again in a minute." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { date?: unknown; ticker?: unknown; side?: unknown } | null;
  const ticker = typeof body?.ticker === "string" ? body.ticker.toUpperCase() : "";
  if (!PLAY_TICKERS.includes(ticker)) return NextResponse.json({ error: "Unknown asset." }, { status: 400 });
  if (!isSide(body?.side)) return NextResponse.json({ error: "Pick up or down." }, { status: 400 });

  const { now } = playNow(req);
  const round = currentPlayRound(now);
  if (body?.date !== round.date) {
    return NextResponse.json({ error: "That round has locked. Picks now go to the next round.", round: round.date }, { status: 409 });
  }

  let uid = playerId(req);
  const fresh = !uid;
  uid ??= newPlayerId();
  await setPick(uid, round.date, ticker, body.side);
  const res = NextResponse.json(await playState(uid, now), { headers: { "Cache-Control": "no-store" } });
  if (fresh) setPlayerCookie(res, uid);
  return res;
}
