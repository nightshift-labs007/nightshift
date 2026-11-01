import { createHmac, randomBytes } from "node:crypto";
import type { BasketAlert, Notifier, ScorecardPost } from "./types";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const pct = (f: string) => `${Number(f) >= 0 ? "+" : "−"}${Math.abs(Number(f) * 100).toFixed(2)}%`;

/** OAuth 1.0a header for a JSON-body request (body params are not signed for JSON). */
export function oauthHeader(method: string, url: string, c: XCredentials, nonce = randomBytes(16).toString("hex"), ts = Math.floor(Date.now() / 1000)): string {
  const params: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(ts),
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k]!)}`)
    .join("&");
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`;
  const signature = createHmac("sha1", `${enc(c.apiSecret)}&${enc(c.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...params, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

/** Posts to X through the v2 create-post endpoint. Confirm the endpoint and your access tier in current X docs. */
export class XNotifier implements Notifier {
  readonly channel = "x" as const;
  constructor(
    private creds: XCredentials,
    private fetchImpl: typeof fetch = fetch,
    private url = "https://api.x.com/2/tweets",
  ) {}

  async publishBasket(a: BasketAlert): Promise<void> {
    const legs = a.legs.map((l) => `$${l.ticker} ${Math.round(l.weight * 100)}%`).join(" · ");
    const proof = a.simulated ? "" : ` · hash ${a.canonical_hash.slice(0, 10)}`;
    await this.post(fit(`⚡ ${a.headline}`, `${a.thesis}\n${legs}\nGraded 9:45 ET vs SPY${proof}\n${a.url}`));
  }

  async publishScorecard(p: ScorecardPost): Promise<void> {
    const wins = p.graded.filter((g) => g.hit).length;
    const lines = p.graded.slice(0, 4).map((g) => `${g.hit ? "✅" : "❌"} ${pct(g.vs_spy_pct)}`);
    await this.post(fit(`📊 Scorecard ${p.date}: ${wins}/${p.graded.length} beat SPY`, `${lines.join(" ")}${p.voids.length ? ` · ${p.voids.length} void` : ""}\nMisses included: ${p.url}`));
  }

  private async post(text: string) {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { authorization: oauthHeader("POST", this.url, this.creds), "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`x: HTTP ${res.status} ${await res.text()}`);
  }
}

/** Keeps the tail (link, proof) intact and trims the headline to fit 280 characters (URLs count as 23). */
function fit(head: string, tail: string): string {
  const urlLen = (s: string) => s.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  const room = 280 - urlLen(tail) - 2;
  return `${head.length > room ? `${head.slice(0, room - 1)}…` : head}\n\n${tail}`;
}
