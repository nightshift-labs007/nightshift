import { NextResponse, type NextRequest } from "next/server";
import { authorized, env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Team-only email check (Bearer CRON_SECRET): sends one message to Resend's test inbox (delivered@resend.dev) with the
 * production key and sender, and returns Resend's answer. Shows why sign-up codes fail without exposing either value.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!env.resendKey || !env.resendFrom) return NextResponse.json({ ok: false, reason: "RESEND_API_KEY or RESEND_FROM is not set" });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.resendFrom, to: ["delivered@resend.dev"], subject: "Nightshift email check", text: "If this arrives, sign-up codes can be sent." }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => e as Error);
  if (res instanceof Error) return NextResponse.json({ ok: false, reason: `network: ${res.message}` });
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    reason: res.ok ? null : `${body?.name ?? ""}: ${body?.message ?? ""}`,
    sender: env.resendFrom.replace(/^.*<|>.*$/g, ""),
    keyPrefix: env.resendKey.slice(0, 3),
    keyLength: env.resendKey.length,
  });
}
