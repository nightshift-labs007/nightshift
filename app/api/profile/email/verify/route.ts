import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { verifyEmailCode } from "@/lib/members";
import { SESSION_COOKIE, SESSION_DAYS, makeSession, profilesEnabled, readSession } from "@/lib/profile";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Sign-up and sign-in, step 2: check the 6-digit code (five wrong tries cancel it). A correct code verifies the email,
 * uses the invite code for a new wallet, and signs the wallet in for 7 days. This replaces the wallet signature.
 */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Sign-up isn't switched on yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { code?: string; address?: string };
  const me = body.address && isAddress(body.address) ? body.address.toLowerCase() : readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Connect your wallet first." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`otp:verify:ip:${ip}`, 60, 3600)).ok) return NextResponse.json({ error: "Too many tries. Please try again later." }, { status: 429 });
  try {
    const r = await verifyEmailCode(me, String(body.code ?? ""));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const res = NextResponse.json({ ok: true, email: r.email, address: me });
    res.cookies.set(SESSION_COOKIE, makeSession(me), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't check the code right now. Please try again." }, { status: 503 });
  }
}
