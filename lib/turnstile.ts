import "server-only";
import { env } from "@/lib/env";

/** Cloudflare Turnstile check. Passes when Turnstile isn't configured (it's optional), fails on a missing or bad token when it is. */
export const captchaOn = () => !!(env.turnstileSecret && env.turnstileSite);

export async function captchaOk(token: unknown, ip: string): Promise<boolean> {
  if (!captchaOn()) return true;
  if (typeof token !== "string" || !token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.turnstileSecret, response: token, remoteip: ip }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { success?: boolean } | null;
  return j?.success === true;
}
