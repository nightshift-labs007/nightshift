import { NextResponse, type NextRequest } from "next/server";
import { requestCode } from "@/lib/play/account";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Sends a 6-digit sign-in code. Body: { email }. Limited per address and per IP. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const [byIp, byEmail] = await Promise.all([allow(`play:code:ip:${ip}`, 10, 3600), allow(`play:code:em:${email.toLowerCase()}`, 3, 600)]);
  if (!byIp.ok || !byEmail.ok) return NextResponse.json({ error: "Too many codes requested. Try again later." }, { status: 429 });
  const r = await requestCode(email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...(r.via === "dev-outbox" ? { note: "Local server: the code is in the dev outbox (/api/play/dev/outbox)." } : {}) });
}
