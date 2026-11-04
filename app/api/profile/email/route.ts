import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { canSendEmailCode, emailEnabled, sendEmailCode } from "@/lib/members";
import { SESSION_COOKIE, profilesEnabled, readSession } from "@/lib/profile";
import { LIMITS } from "@/lib/profile-shared";
import { allow, take } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Sign-up and sign-in, step 1: email a 6-digit code. No wallet signature: the wallet is the connected address, and the
 * email code is what proves the person. A new wallet sends its invite code too (checked now, used once the code is
 * verified); a registered wallet without a session can only get a code at its own email.
 */
export async function POST(req: NextRequest) {
  if (!profilesEnabled() || !emailEnabled()) return NextResponse.json({ error: "Email verification isn't switched on yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; address?: string; invite?: string };
  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  // the connected wallet wins; a session only counts when it's for that same wallet
  const me = body.address && isAddress(body.address) ? body.address.toLowerCase() : session;
  if (!me) return NextResponse.json({ error: "Connect your wallet first." }, { status: 400 });
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // guessing invite codes: a few tries per wallet and per network
  if (body.invite && (!(await allow(`invite:${me}`, 10, 3600)).ok || !(await allow(`invite:ip:${ip}`, 30, 3600)).ok))
    return NextResponse.json({ error: "Too many tries. Please wait an hour and try again." }, { status: 429 });
  let invite: string | undefined;
  try {
    const can = await canSendEmailCode(me, email, { signedIn: !!session && session === me, invite: body.invite });
    if (!can.ok) return NextResponse.json({ error: can.error }, { status: can.status });
    invite = can.invite;
  } catch {
    return NextResponse.json({ error: "Couldn't send the code right now. Please try again." }, { status: 503 });
  }
  if (!(await take(`otp:wait:${me}`, 45))) return NextResponse.json({ error: "A code was just sent. Wait a minute before asking for another." }, { status: 429 });
  if (!(await allow(`otp:send:${me}`, 6, 3600)).ok || !(await allow(`otp:email:${email}`, 6, 3600)).ok || !(await allow(`otp:ip:${ip}`, 20, 3600)).ok)
    return NextResponse.json({ error: "Too many codes sent. Please try again in an hour." }, { status: 429 });
  try {
    const r = await sendEmailCode(me, email, invite);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Couldn't send the code right now. Please try again." }, { status: 503 });
  }
}
