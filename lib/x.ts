import "server-only";
import crypto from "node:crypto";

/**
 * Minimal X (Twitter) client: posts as @nightshift_si with OAuth 1.0a user context.
 * Keys come from X_API_KEY / X_API_SECRET (the app) and X_ACCESS_TOKEN / X_ACCESS_SECRET (the account);
 * the access token must have been generated after the app was set to "Read and write".
 */
const v = (k: string) => (process.env[k] ?? "").trim();
const keys = () => ({ key: v("X_API_KEY"), secret: v("X_API_SECRET"), token: v("X_ACCESS_TOKEN"), tokenSecret: v("X_ACCESS_SECRET") });

export const xConfigured = () => Object.values(keys()).every(Boolean);
/** X_POSTING=off pauses the agent without removing the keys. */
export const xPostingOn = () => v("X_POSTING").toLowerCase() !== "off";

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(method: string, url: string) {
  const k = keys();
  const u = new URL(url);
  const o: Record<string, string> = {
    oauth_consumer_key: k.key,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: k.token,
    oauth_version: "1.0",
  };
  // JSON bodies are not part of the OAuth 1.0a signature; query parameters are
  const all: Record<string, string> = { ...o, ...Object.fromEntries(u.searchParams) };
  const params = Object.keys(all).sort().map((p) => `${enc(p)}=${enc(all[p])}`).join("&");
  const base = [method, enc(u.origin + u.pathname), enc(params)].join("&");
  o.oauth_signature = crypto.createHmac("sha1", `${enc(k.secret)}&${enc(k.tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(o).sort().map((p) => `${enc(p)}="${enc(o[p])}"`).join(", ");
}

/** Characters as X counts them: most Latin text is 1, other code points (emoji, CJK, some symbols) are 2. */
export function xLength(text: string) {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
  }
  return n;
}

export async function postToX(text: string): Promise<{ id: string; url: string }> {
  if (!xConfigured()) throw new Error("X keys are not configured");
  if (xLength(text) > 280) throw new Error(`post is ${xLength(text)} characters (max 280)`);
  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: authHeader("POST", url), "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string }; detail?: string; title?: string };
  if (!res.ok || !body.data?.id) {
    const level = res.headers.get("x-access-level");
    const hint = res.status === 403 && level === "read" ? " (the access token is read-only: regenerate it after setting the app to Read and write)" : "";
    throw new Error(`X ${res.status}: ${body.detail ?? body.title ?? "post failed"}${hint}`);
  }
  return { id: body.data.id, url: `https://x.com/nightshift_si/status/${body.data.id}` };
}

/** Who the keys post as, and with which permission ("read" or "read-write"). One read request. */
export async function xWhoAmI() {
  const url = "https://api.x.com/2/users/me";
  const res = await fetch(url, { headers: { authorization: authHeader("GET", url) }, signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { data?: { username: string } };
  return { status: res.status, username: body.data?.username ?? null, accessLevel: res.headers.get("x-access-level") };
}
