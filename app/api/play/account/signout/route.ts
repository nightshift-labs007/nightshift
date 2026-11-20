import { NextResponse } from "next/server";
import { setPlayerCookie } from "@/lib/play/state";

export const dynamic = "force-dynamic";

/** Signs this browser out of its account. Its picks stay with the account; play continues anonymously from scratch. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  setPlayerCookie(res, null);
  return res;
}
