import { NextResponse, type NextRequest } from "next/server";
import { getMember, setPassword } from "@/lib/members";
import { SESSION_COOKIE, profilesEnabled, readSession } from "@/lib/profile";
import { PASSWORD } from "@/lib/profile-shared";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Sets (or resets) the signed-in member's password. The session itself came from an email code or the current password. */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await allow(`password:set:${me}`, 10, 3600)).ok) return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const pw = String(password ?? "");
  if (pw.length < PASSWORD.min || pw.length > PASSWORD.max) return NextResponse.json({ error: `Use ${PASSWORD.min} to ${PASSWORD.max} characters.` }, { status: 400 });
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return NextResponse.json({ error: "Use at least one letter and one number." }, { status: 400 });
  try {
    if (!(await getMember(me)).email) return NextResponse.json({ error: "Verify your email first." }, { status: 403 });
    await setPassword(me, pw);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save the password right now. Please try again." }, { status: 503 });
  }
}
