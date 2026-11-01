import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/env";
import { createInvites, listInvites } from "@/lib/members";
import { profilesEnabled } from "@/lib/profile";

export const dynamic = "force-dynamic";

// Team only (Authorization: Bearer <CRON_SECRET>). Use scripts/invites.mjs rather than calling this by hand.

/** Every invite code, with how many seats are used and by which wallets. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!profilesEnabled()) return NextResponse.json({ error: "The member store isn't configured." }, { status: 503 });
  return NextResponse.json({ invites: await listInvites() }, { headers: { "Cache-Control": "no-store" } });
}

/** Create codes: { count: 1-50, uses: 1-1000, note } */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!profilesEnabled()) return NextResponse.json({ error: "The member store isn't configured." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { count?: number; uses?: number; note?: string };
  const count = Math.min(50, Math.max(1, Math.floor(Number(b.count) || 1)));
  const uses = Math.min(1000, Math.max(1, Math.floor(Number(b.uses) || 1)));
  return NextResponse.json({ codes: await createInvites(count, uses, String(b.note ?? "")), uses });
}
