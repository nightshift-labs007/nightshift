import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, emailOwner } from "@/lib/members";
import { SESSION_COOKIE, SESSION_DAYS, makeSession, profilesEnabled } from "@/lib/profile";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Sign in with email + password (members who set one). Finds the wallet the verified email belongs to, checks the
 * password against its scrypt hash and sets the 7-day session. One answer for every failure, so it doesn't reveal
 * which emails are members; attempts are limited per email and per network.
 */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Sign-in isn't switched on yet." }, { status: 503 });
  const { email: raw, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`login:email:${email}`, 8, 900)).ok || !(await allow(`login:ip:${ip}`, 30, 900)).ok)
    return NextResponse.json({ error: "Too many tries. Wait 15 minutes, or use “Email me a code”." }, { status: 429 });
  const fail = NextResponse.json({ error: "Wrong email or password. No password yet? Use “Email me a code” once to set one." }, { status: 401 });
  try {
    const owner = await emailOwner(email);
    if (!owner || !(await checkPassword(owner, String(password)))) return fail;
    const res = NextResponse.json({ ok: true, address: owner });
    res.cookies.set(SESSION_COOKIE, makeSession(owner), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't sign you in right now. Please try again." }, { status: 503 });
  }
}
