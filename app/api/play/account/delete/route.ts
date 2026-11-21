import { NextResponse, type NextRequest } from "next/server";
import { deleteAccount } from "@/lib/play/account";
import { playerId, setPlayerCookie } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/** Deletes the signed-in account and its picks, and signs this browser out. Body: { confirm: "delete" }. */
export async function POST(req: NextRequest) {
  const uid = playerId(req);
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "delete") return NextResponse.json({ error: "Confirmation missing." }, { status: 400 });
  if (!uid || !(await deleteAccount(uid))) return NextResponse.json({ error: "No account is signed in on this browser." }, { status: 404 });
  const res = NextResponse.json({ ok: true });
  setPlayerCookie(res, null);
  return res;
}
