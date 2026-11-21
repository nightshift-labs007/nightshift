// The site's one public address. Pure (no imports) so it can be unit-tested.
// https://www.nightshift.buzz is canonical: the bare nightshift.buzz is forwarded to it at the DNS provider.

export const CANONICAL_ORIGIN = "https://www.nightshift.buzz";

type Env = Record<string, string | undefined>;

/** Origin for links in emails and share cards: SITE_URL if set, a Vercel preview's own URL, else canonical in production. */
export function siteOrigin(env: Env = process.env): string {
  const set = (env.SITE_URL ?? "").trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
  if (set) return set;
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NIGHTSHIFT_ENV === "production" || env.NODE_ENV === "production") return CANONICAL_ORIGIN;
  return "http://localhost:3000";
}

/** The canonical URL for a request path (query and hash dropped). */
export const canonicalUrl = (path: string): string => CANONICAL_ORIGIN + (path.replace(/[?#].*$/, "") || "/");
