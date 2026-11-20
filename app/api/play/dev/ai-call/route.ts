import { NextResponse, type NextRequest } from "next/server";
import { setAiCallForTest } from "@/lib/play/ai";

export const dynamic = "force-dynamic";

/**
 * Local servers only: set Nightshift's "Beat the AI" call for a session, so the mode can be tested on a past open
 * (the real call is taken live at 20:00 ET and can't be recreated for past dates). 404 in production.
 * Body: { session: "YYYY-MM-DD", at: <epoch ms>, p: { NVDA: 140.1, … } }
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { session?: string; at?: number; p?: Record<string, number> } | null;
  if (!b?.session || !/^\d{4}-\d{2}-\d{2}$/.test(b.session) || !b.p) return NextResponse.json({ error: "session and p required" }, { status: 400 });
  await setAiCallForTest({ session: b.session, at: b.at ?? Date.now(), p: b.p });
  return NextResponse.json({ ok: true });
}
