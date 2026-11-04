import { NextResponse, type NextRequest } from "next/server";
import { recordJoin } from "@/lib/ledger";
import { claimUsername, emailEnabled, getMember, isRegistered, markRegistered, membership, releaseMember } from "@/lib/members";
import { SESSION_COOKIE, deleteProfile, getAvatarAt, getProfile, profilesEnabled, readSession, saveProfile } from "@/lib/profile";
import { EMPTY_PROFILE, validateProfile, type Profile } from "@/lib/profile-shared";
import { allow } from "@/lib/ratelimit";
import { invalidateLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "private, no-store" };

/** The signed-in wallet's own profile, email included, and where it is in sign-up. Requires the session cookie. */
export async function GET(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ enabled: false }, { headers: noStore });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ enabled: true, signedIn: false }, { headers: noStore });
  try {
    const [stored, avatarAt] = await Promise.all([getProfile(me), getAvatarAt(me)]);
    const member = await membership(me, stored);
    // older profiles have no username yet; the verified email always comes from sign-up, never from the form
    const profile = { ...EMPTY_PROFILE, ...(stored ?? {}), email: member.email ?? "" };
    return NextResponse.json({ enabled: true, signedIn: true, address: me, profile, exists: !!stored, avatarAt, member, emailEnabled: emailEnabled() }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "The profile store is unavailable right now." }, { status: 503, headers: noStore });
  }
}

/** Save the signed-in wallet's profile. Needs an invite code and a verified email first; the username must be free. */
export async function PUT(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Verify your email first." }, { status: 401 });
  if (!(await allow(`profile:save:${me}`, 30, 3600)).ok) return NextResponse.json({ error: "Too many saves. Try again in a while." }, { status: 429 });
  const v = validateProfile((await req.json().catch(() => ({}))) as Partial<Profile>);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const [m, prev] = await Promise.all([getMember(me), getProfile(me)]);
    if (!m.invite) return NextResponse.json({ error: "Enter your invite code first." }, { status: 403 });
    if (!m.email) return NextResponse.json({ error: "Verify your email first." }, { status: 403 });
    if (!(await claimUsername(me, v.profile.username, prev?.username || undefined)))
      return NextResponse.json({ error: `@${v.profile.username} is taken. Try another username.` }, { status: 409 });
    const saved = await saveProfile(me, { ...v.profile, email: m.email });
    const first = !(await isRegistered(me));
    await markRegistered(me);
    // signing up is joining the leaderboard: the sign-up is recorded on Base for them, with no extra signature
    if (first) await recordJoin(me).catch((e) => console.error("leaderboard join failed", e));
    invalidateLeaderboard();
    return NextResponse.json({ ok: true, profile: saved, member: await membership(me, saved) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Couldn't save right now. Please try again." }, { status: 503 });
  }
}

/** Delete the signed-in wallet's profile completely: frees the username and email. The invite code stays used. */
export async function DELETE(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  await releaseMember(me, await getProfile(me));
  await deleteProfile(me);
  invalidateLeaderboard();
  return NextResponse.json({ ok: true }, { headers: noStore });
}
