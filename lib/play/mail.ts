import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { createHash } from "crypto";
import { env } from "@/lib/env";
import { allow } from "@/lib/ratelimit";
import { testMode } from "@/lib/play/testmode";

/**
 * Email for the points game (sign-in codes and reminders). Sends through Resend when RESEND_API_KEY and RESEND_FROM
 * are set. Without them, in test mode only (local, or a preview with PLAY_TEST_MODE=1), messages go to an in-memory dev outbox (GET /api/play/dev/outbox)
 * so the flows can be tested locally; in production without Resend, sending fails and the caller says so.
 */
export type Mail = { to: string; subject: string; text: string; html?: string; unsubscribeUrl?: string };
export type Sent = { ok: true; via: "resend" | "dev-outbox" } | { ok: false; error: string };

const g = globalThis as unknown as { __playOutbox?: (Mail & { at: number })[] };
const outbox = (g.__playOutbox ??= []);
export const devOutbox = () => outbox.slice(-50);

const resendOn = () => !!(env.resendKey && env.resendFrom);
export const mailEnabled = () => resendOn() || testMode();

/** At most this many emails of any kind to one address per day (codes and reminders together). */
export const MAX_MAIL_PER_ADDRESS_PER_DAY = 10;

export async function sendMail(m: Mail): Promise<Sent> {
  const who = createHash("sha256").update(m.to.trim().toLowerCase()).digest("hex").slice(0, 32);
  if (!(await allow(`mail:day:${who}`, MAX_MAIL_PER_ADDRESS_PER_DAY, 86400)).ok) return { ok: false, error: "Too many emails to this address today. Try again tomorrow." };
  if (!resendOn()) {
    if (!testMode()) return { ok: false, error: "Email isn't set up on this server yet." };
    outbox.push({ ...m, at: Date.now() });
    console.log(`[dev outbox] to ${m.to}: ${m.subject}`);
    return { ok: true, via: "dev-outbox" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.resendFrom,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      ...(m.html ? { html: m.html } : {}),
      ...(m.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return { ok: false, error: "We couldn't send the email right now. Please try again in a minute." };
  return { ok: true, via: "resend" };
}

/**
 * The secret for codes, unsubscribe links and share cards: PLAY_SECRET, else CRON_SECRET (16+ chars), else, outside
 * production only, a fixed dev value. Null in production without a secret, which turns those features off.
 */
export function playSecret(): string | null {
  const s = (process.env.PLAY_SECRET ?? "").trim() || (env.cronSecret.length >= 16 ? env.cronSecret : "");
  if (s) return s;
  return process.env.NODE_ENV === "production" ? null : "nightshift-dev-only-play-secret";
}

export function sign(data: string): string | null {
  const s = playSecret();
  return s ? createHmac("sha256", s).update(`play:${data}`).digest("base64url") : null;
}

export function verifySig(data: string, sig: string): boolean {
  const want = sign(data);
  if (!want || !sig) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The site's own origin for links in emails and share cards. */
export const siteOrigin = () =>
  (process.env.SITE_URL ?? "").trim().replace(/\/$/, "") ||
  (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NODE_ENV === "production" ? "https://nightshift.buzz" : "http://localhost:3000");
