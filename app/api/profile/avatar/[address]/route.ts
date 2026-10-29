import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getAvatar, getProfile, profilesEnabled, readSession } from "@/lib/profile";

export const dynamic = "force-dynamic";

/**
 * A wallet's profile photo. Everyone can see it when the owner shows their profile publicly (the default); otherwise
 * only the owner, signed in on this browser, can. 404 when there is no photo, so pages fall back to a drawn badge.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const address = (await params).address.toLowerCase();
  if (!profilesEnabled() || !/^0x[0-9a-f]{40}$/.test(address)) return new NextResponse(null, { status: 404 });
  const owner = readSession(req.cookies.get(SESSION_COOKIE)?.value) === address;
  try {
    const [b64, profile] = await Promise.all([getAvatar(address), getProfile(address)]);
    const hidden = profile?.showPublic === false;
    if (!b64 || (hidden && !owner)) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=60" } });
    return new NextResponse(new Uint8Array(Buffer.from(b64, "base64")), {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        // public photos are cached briefly; pages add ?v=<version> after a change, so a new photo shows at once
        "Cache-Control": hidden ? "private, no-store" : "public, max-age=300",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
