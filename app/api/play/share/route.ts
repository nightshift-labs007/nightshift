import { NextResponse, type NextRequest } from "next/server";
import { makeShare } from "@/lib/play/share";
import { playNow, playerId } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/** A signed share link for one of your rounds. Body: { mode: "close" | "ai", date }. Returns { url, text, x, telegram }. */
export async function POST(req: NextRequest) {
  const uid = playerId(req);
  if (!uid) return NextResponse.json({ error: "Make a pick first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { mode?: unknown; date?: unknown } | null;
  const mode = body?.mode === "ai" ? "ai" : "close";
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
  const s = date ? await makeShare(uid, mode, date, playNow(req).now) : null;
  if (!s) return NextResponse.json({ error: "Nothing to share for that round." }, { status: 404 });
  const q = encodeURIComponent;
  return NextResponse.json({
    ...s,
    x: `https://x.com/intent/post?text=${q(s.text)}&url=${q(s.url)}`,
    telegram: `https://t.me/share/url?url=${q(s.url)}&text=${q(s.text)}`,
  });
}
