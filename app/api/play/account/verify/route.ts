import { NextResponse, type NextRequest } from "next/server";
import { verifyCode } from "@/lib/play/account";
import { playNow, playState, playerId, setPlayerCookie } from "@/lib/play/state";
import { track } from "@/lib/ops";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Checks a sign-in code. Body: { email, code, nick? }. A new email creates an account (with `nick`, or a generated
 * one); a known email signs in and merges this browser's picks into that account. The cookie then holds the account.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await allow(`play:verify:${ip}`, 20, 600)).ok) return NextResponse.json({ error: "Too many tries. Try again later." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; code?: unknown; nick?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const nick = typeof body?.nick === "string" ? body.nick : undefined;
  const r = await verifyCode(email, code, playerId(req), nick);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  if (r.created) await track("signup", r.uid);
  const res = NextResponse.json({ created: r.created, state: await playState(r.uid, playNow(req).now) });
  setPlayerCookie(res, r.uid);
  return res;
}
