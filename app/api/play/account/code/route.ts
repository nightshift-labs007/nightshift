import { NextResponse, type NextRequest } from "next/server";
import { requestCode } from "@/lib/play/account";
import { track } from "@/lib/ops";
import { allow } from "@/lib/ratelimit";
import { captchaOk } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

/** Sends a 6-digit sign-in code. Body: { email }. Limited per address and per IP. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; captcha?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  // caps: per IP 10 an hour and 20 a day; per address 3 per 10 minutes and 5 a day (sendMail also caps all mail per address)
  const key = email.toLowerCase();
  const caps = await Promise.all([
    allow(`play:code:ip:${ip}`, 10, 3600),
    allow(`play:code:ipday:${ip}`, 20, 86400),
    allow(`play:code:em:${key}`, 3, 600),
    allow(`play:code:emday:${key}`, 5, 86400),
  ]);
  if (caps.some((c) => !c.ok)) return NextResponse.json({ error: "Too many codes requested. Try again later." }, { status: 429 });
  if (!(await captchaOk(body?.captcha, ip))) return NextResponse.json({ error: "Please complete the check and try again." }, { status: 400 });
  const r = await requestCode(email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await track("code_sent");
  return NextResponse.json({ ok: true, ...(r.via === "dev-outbox" ? { note: "Local server: the code is in the dev outbox (/api/play/dev/outbox)." } : {}) });
}
