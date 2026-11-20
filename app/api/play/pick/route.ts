import { NextResponse, type NextRequest } from "next/server";
import { PLAY_TICKERS, isSide } from "@/lib/play-rules";
import { getAiCall } from "@/lib/play/ai";
import { setPick } from "@/lib/play/store";
import { newPlayerId, playNow, playState, playerId, setPlayerCookie } from "@/lib/play/state";
import { track } from "@/lib/ops";
import { allow } from "@/lib/ratelimit";
import { currentAiRound, currentPlayRound } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Make or change a pick. Body: { mode?: "close" | "ai", date, ticker, side: "up" | "down" }.
 * - close (default): up or down vs the close of round `date`, until that close.
 * - ai: above or below Nightshift's evening call for session `date`, from the call until 04:00 ET.
 * `date` is the round the page showed; if it has locked in the meantime the pick is refused, never moved.
 * No wallet or account needed: the first pick sets an anonymous cookie.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  // abuse limits: per IP per minute and per day, per player per hour (a full round is 5 picks; changing them is allowed)
  const [perMin, perDay] = await Promise.all([allow(`play:pick:${ip}`, 60, 60), allow(`play:pick:day:${ip}`, 2000, 86400)]);
  if (!perMin.ok || !perDay.ok) return NextResponse.json({ error: "Too many picks. Try again later." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { mode?: unknown; date?: unknown; ticker?: unknown; side?: unknown } | null;
  const mode = body?.mode === "ai" ? "ai" : "close";
  const ticker = typeof body?.ticker === "string" ? body.ticker.toUpperCase() : "";
  if (!PLAY_TICKERS.includes(ticker)) return NextResponse.json({ error: "Unknown asset." }, { status: 400 });
  if (!isSide(body?.side)) return NextResponse.json({ error: "Pick up or down." }, { status: 400 });

  const { now } = playNow(req);
  let date: string;
  if (mode === "ai") {
    const r = currentAiRound(now);
    const call = await getAiCall(r.date);
    if (body?.date !== r.date || now < r.callMs) return NextResponse.json({ error: "That round isn't taking picks.", round: r.date }, { status: 409 });
    if (!call || call.p[ticker] === undefined) return NextResponse.json({ error: "Nightshift hasn't made its call for that asset yet." }, { status: 409 });
    date = r.date;
  } else {
    const r = currentPlayRound(now);
    if (body?.date !== r.date) return NextResponse.json({ error: "That round has locked. Picks now go to the next round.", round: r.date }, { status: 409 });
    date = r.date;
  }

  let uid = playerId(req);
  const fresh = !uid;
  uid ??= newPlayerId();
  if (!(await allow(`play:pick:uid:${uid}`, 120, 3600)).ok) return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429 });
  await setPick(uid, date, ticker, body.side, mode);
  await track("pick", uid, now);
  const res = NextResponse.json(await playState(uid, now), { headers: { "Cache-Control": "no-store" } });
  if (fresh) setPlayerCookie(res, uid);
  return res;
}
