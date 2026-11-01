import { NextResponse, type NextRequest } from "next/server";
import { verifyEmailCode } from "@/lib/members";
import { SESSION_COOKIE, profilesEnabled, readSession } from "@/lib/profile";

export const dynamic = "force-dynamic";

/** Step 2 of sign-up, continued: check the 6-digit code. Five wrong tries cancel it. */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Sign-up isn't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  try {
    const r = await verifyEmailCode(me, String(code ?? ""));
    return r.ok ? NextResponse.json({ ok: true, email: r.email }) : NextResponse.json({ error: r.error }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Couldn't check the code right now. Please try again." }, { status: 503 });
  }
}
