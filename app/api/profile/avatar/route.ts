import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, deleteAvatar, profilesEnabled, readSession, saveAvatar } from "@/lib/profile";
import { AVATAR } from "@/lib/profile-shared";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const PREFIX = "data:image/jpeg;base64,";

/** Upload the signed-in wallet's profile photo: a JPEG data URL the browser already cropped and resized. */
export async function PUT(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  if (!(await allow(`profile:avatar:${me}`, 20, 3600)).ok) return NextResponse.json({ error: "Too many uploads. Try again in a while." }, { status: 429 });
  const { image } = (await req.json().catch(() => ({}))) as { image?: string };
  if (typeof image !== "string" || !image.startsWith(PREFIX)) return NextResponse.json({ error: "Please choose a photo (JPEG, PNG or WebP)." }, { status: 400 });
  const bytes = Buffer.from(image.slice(PREFIX.length), "base64");
  // small, and a real JPEG (starts FF D8 FF): the page crops and resizes to 256 × 256 before sending
  if (bytes.length > AVATAR.maxBytes) return NextResponse.json({ error: "That photo is too large. Try a smaller one." }, { status: 413 });
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return NextResponse.json({ error: "That file isn't a photo we can use." }, { status: 400 });
  try {
    const avatarAt = await saveAvatar(me, bytes.toString("base64"));
    return NextResponse.json({ ok: true, avatarAt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't save right now. Please try again." }, { status: 503 });
  }
}

/** Remove the signed-in wallet's profile photo. */
export async function DELETE(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const me = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  await deleteAvatar(me);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
