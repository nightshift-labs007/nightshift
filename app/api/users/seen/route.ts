import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { markSeen } from "@/lib/members";
import { profilesEnabled } from "@/lib/profile";
import { allow } from "@/lib/ratelimit";
import { invalidateLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/** Counts a wallet as a Nightshift user the first time it connects (the page calls this on connect). */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false }, { status: 503 });
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // a browser switches between a few wallets at most; this keeps scripts from filling the list
  if (!(await allow(`seen:ip:${ip}`, 12, 86400)).ok) return NextResponse.json({ ok: true, counted: false });
  try {
    const counted = await markSeen(address);
    if (counted) invalidateLeaderboard();
    return NextResponse.json({ ok: true, counted });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
