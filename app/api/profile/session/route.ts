import { NextResponse, type NextRequest } from "next/server";
import { isAddress, recoverMessageAddress } from "viem";
import { SESSION_COOKIE, SESSION_DAYS, makeSession, profilesEnabled } from "@/lib/profile";
import { signInMessage } from "@/lib/profile-shared";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const SIG_MAX_AGE_MS = 5 * 60 * 1000;

/** Sign in: verifies a free signed message and sets a 7-day HttpOnly session cookie for that wallet. */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Profiles aren't switched on yet." }, { status: 503 });
  const { address, signature, issuedAt } = (await req.json().catch(() => ({}))) as { address?: string; signature?: `0x${string}`; issuedAt?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`signin:ip:${ip}`, 30, 3600)).ok) return NextResponse.json({ error: "Too many sign-ins. Try again later." }, { status: 429 });
  const age = Date.now() - Date.parse(issuedAt ?? "");
  if (!signature || !(age >= -60_000 && age < SIG_MAX_AGE_MS)) return NextResponse.json({ error: "Please sign the message in your wallet." }, { status: 401 });
  const signer = await recoverMessageAddress({ message: signInMessage(address, issuedAt!), signature }).catch(() => null);
  if (!signer || signer.toLowerCase() !== address.toLowerCase()) return NextResponse.json({ error: "Signature doesn't match this address." }, { status: 401 });
  const res = NextResponse.json({ ok: true, address: address.toLowerCase() });
  res.cookies.set(SESSION_COOKIE, makeSession(address), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
