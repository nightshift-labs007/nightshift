import { NextResponse, type NextRequest } from "next/server";
import { canSendEmailCode, emailEnabled, sendEmailCode } from "@/lib/members";
import { SESSION_COOKIE, profilesEnabled, readSession } from "@/lib/profile";
import { LIMITS } from "@/lib/profile-shared";
import { allow, take } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Step 2 of sign-up: email a 6-digit code to the address the signed-in wallet wants to verify. */
export async function POST(req: NextRequest) {
  if (!profilesEnabled() || !emailEnabled()) return NextResponse.json({ error: "Email verification isn't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  const { email: raw } = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    const can = await canSendEmailCode(me, email);
    if (!can.ok) return NextResponse.json({ error: can.error }, { status: can.status });
  } catch {
    return NextResponse.json({ error: "Couldn't send the code right now. Please try again." }, { status: 503 });
  }
  if (!(await take(`otp:wait:${me}`, 45))) return NextResponse.json({ error: "A code was just sent. Wait a minute before asking for another." }, { status: 429 });
  if (!(await allow(`otp:send:${me}`, 6, 3600)).ok || !(await allow(`otp:email:${email}`, 6, 3600)).ok || !(await allow(`otp:ip:${ip}`, 20, 3600)).ok)
    return NextResponse.json({ error: "Too many codes sent. Please try again in an hour." }, { status: 429 });
  try {
    const r = await sendEmailCode(me, email);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Couldn't send the code right now. Please try again." }, { status: 503 });
  }
}
