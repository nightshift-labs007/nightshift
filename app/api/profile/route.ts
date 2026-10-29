import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, deleteProfile, getAvatarAt, getProfile, profilesEnabled, readSession, saveProfile } from "@/lib/profile";
import { EMPTY_PROFILE, validateProfile, type Profile } from "@/lib/profile-shared";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

/** The signed-in wallet's own profile, email included. Requires the session cookie. */
export async function GET(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ enabled: false }, { headers: noStore });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ enabled: true, signedIn: false }, { headers: noStore });
  try {
    const [stored, avatarAt] = await Promise.all([getProfile(me), getAvatarAt(me)]);
    const profile = stored ?? EMPTY_PROFILE;
    return NextResponse.json({ enabled: true, signedIn: true, address: me, profile, exists: profile !== EMPTY_PROFILE, avatarAt }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "The profile store is unavailable right now." }, { status: 503, headers: noStore });
  }
}

/** Save the signed-in wallet's profile. */
export async function PUT(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  if (!(await allow(`profile:save:${me}`, 30, 3600)).ok) return NextResponse.json({ error: "Too many saves. Try again in a while." }, { status: 429 });
  const v = validateProfile((await req.json().catch(() => ({}))) as Partial<Profile>);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const saved = await saveProfile(me, v.profile);
    return NextResponse.json({ ok: true, profile: saved }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Couldn't save right now. Please try again." }, { status: 503 });
  }
}

/** Delete the signed-in wallet's profile completely. */
export async function DELETE(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  await deleteProfile(me);
  return NextResponse.json({ ok: true }, { headers: noStore });
}
