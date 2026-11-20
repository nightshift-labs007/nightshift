import { NextResponse, type NextRequest } from "next/server";
import { getAccount, renameNick, setReminders } from "@/lib/play/account";
import { playNow, playState, playerId } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/** Account settings. Body: { remind?: { open, lock, results }, nick? }. Signed-in players only. */
export async function POST(req: NextRequest) {
  const uid = playerId(req);
  if (!uid || !(await getAccount(uid))) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { remind?: { open?: unknown; lock?: unknown; results?: unknown }; nick?: unknown } | null;
  if (typeof body?.nick === "string") {
    const r = await renameNick(uid, body.nick);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  }
  if (body?.remind) await setReminders(uid, { open: body.remind.open === true, lock: body.remind.lock === true, results: body.remind.results === true });
  return NextResponse.json(await playState(uid, playNow(req).now));
}
