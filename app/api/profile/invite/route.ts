import { NextResponse, type NextRequest } from "next/server";
import { redeemInvite } from "@/lib/members";
import { SESSION_COOKIE, profilesEnabled, readSession } from "@/lib/profile";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Step 1 of sign-up: the signed-in wallet uses an invite code. */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Sign-up isn't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // guessing codes: a few tries per wallet and per network
  if (!(await allow(`invite:${me}`, 10, 3600)).ok || !(await allow(`invite:ip:${ip}`, 30, 3600)).ok)
    return NextResponse.json({ error: "Too many tries. Please wait an hour and try again." }, { status: 429 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  try {
    const r = await redeemInvite(me, code ?? "");
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Couldn't check the code right now. Please try again." }, { status: 503 });
  }
}
