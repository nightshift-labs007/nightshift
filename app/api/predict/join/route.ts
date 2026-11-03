import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { addMemberNow } from "@/lib/chain/predictions";
import { isRegistered } from "@/lib/members";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A wallet that just finished sign-up asks to be added to the prediction contract's allow-list now, instead of waiting
 * for the keeper's next 5-minute sync. Only registered wallets are added, so there's nothing to prove beyond the address.
 */
export async function POST(req: NextRequest) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  if (!(await isRegistered(address).catch(() => false))) return NextResponse.json({ error: "Finish sign-up first." }, { status: 403 });
  if (!(await allow(`predict:join:${address.toLowerCase()}`, 5, 3600)).ok) return NextResponse.json({ error: "Try again in a few minutes." }, { status: 429 });
  try {
    return NextResponse.json(await addMemberNow(address));
  } catch (e) {
    console.error("predict join failed", e);
    return NextResponse.json({ error: "Couldn't add you right now. The keeper will within 5 minutes." }, { status: 502 });
  }
}
