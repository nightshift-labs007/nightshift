import { describe, expect, it } from "vitest";
import { cosine, HashingEmbedder } from "./embeddings";
import { parseFeed } from "./news/rss";

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Fed</title>
<item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/a.htm</link>
<guid>fomc-1</guid><description>&lt;p&gt;The Committee decided to &lt;b&gt;lower&lt;/b&gt; the target range.&lt;/p&gt;</description>
<pubDate>Wed, 21 Oct 2026 18:00:00 GMT</pubDate></item>
<item><title></title><link>https://x/</link></item>
</channel></rss>`;

const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>ECB keeps rates unchanged</title><id>tag:ecb,1</id>
<link rel="alternate" href="https://ecb.example/pr1"/><updated>2026-10-21T12:15:00Z</updated>
<summary>Governing Council decision.</summary></entry></feed>`;

describe("parseFeed", () => {
  it("reads RSS items, strips HTML and skips untitled items", () => {
    const [h, ...rest] = parseFeed(rss);
    expect(rest).toEqual([]);
    expect(h).toMatchObject({
      source_item_id: "fomc-1",
      title: "Federal Reserve issues FOMC statement",
      summary: "The Committee decided to lower the target range.",
    });
    expect(h?.published_at?.toISOString()).toBe("2026-10-21T18:00:00.000Z");
  });

  it("reads Atom entries", () => {
    expect(parseFeed(atom)).toMatchObject([{ source_item_id: "tag:ecb,1", url: "https://ecb.example/pr1", title: "ECB keeps rates unchanged" }]);
  });
});

describe("HashingEmbedder", () => {
  it("scores near-duplicates high and unrelated headlines low", async () => {
    const e = new HashingEmbedder(1024);
    const [a, b, c] = await e.embed([
      "Tanker attacked in Strait of Hormuz, Brent crude jumps 4%",
      "Tanker attacked in Strait of Hormuz; Brent crude jumps 4%",
      "Nvidia faces new chip export curbs to China",
    ]);
    expect(cosine(a!, b!)).toBeGreaterThan(0.9);
    expect(cosine(a!, c!)).toBeLessThan(0.3);
  });
});

describe("TelegramNotifier", () => {
  it("posts an escaped HTML basket card with the proof and the advice label", async () => {
    const { TelegramNotifier } = await import("./notify/telegram");
    const sent: { url: string; body: { chat_id: string; text: string; parse_mode: string } }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await new TelegramNotifier("TOKEN", "@nightshift-signals", fake).publishBasket({
      basket_id: "bkt_1",
      url: "https://f.app/b/bkt_1",
      headline: "Oil <spikes> & gold",
      thesis: "Shipping risk lifts oil.",
      thesis_i18n: {},
      severity: 4,
      category: "geopolitics_energy",
      legs: [{ ticker: "XLE", weight: 0.6 }, { ticker: "GLD", weight: 0.4 }],
      confidence: 0.62,
      canonical_hash: `0x${"ab".repeat(32)}`,
      commit_tx: "0x1",
      commit_pending: false,
      simulated: false,
    });
    expect(sent[0]!.url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(sent[0]!.body.text).toContain("Oil &lt;spikes&gt; &amp; gold");
    expect(sent[0]!.body.text).toContain("XLE 60% · GLD 40%");
    expect(sent[0]!.body.text).toContain("Information, not advice.");
  });
});

describe("XNotifier", () => {
  it("builds a complete OAuth 1.0a header", async () => {
    const { oauthHeader } = await import("./notify/x");
    // Twitter's documented signing example (consumer/token values from their docs).
    const h = oauthHeader(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      { apiKey: "xvz1evFS4wEEPTGEFPHBog", apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      1318622958,
    );
    expect(h).toContain('oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg"');
    expect(h).toMatch(/oauth_signature="[A-Za-z0-9%]+"/);
  });

  it("keeps posts within 280 characters with the link intact", async () => {
    const { XNotifier } = await import("./notify/x");
    const bodies: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)).text);
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    await new XNotifier({ apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" }, fake).publishBasket({
      basket_id: "bkt_1", url: "https://nightshift-signals.app/b/bkt_1", headline: "H".repeat(400), thesis: "Shipping risk lifts oil.",
      thesis_i18n: {}, severity: 4, category: null, legs: [{ ticker: "XLE", weight: 1 }], confidence: 0.6,
      canonical_hash: `0x${"ab".repeat(32)}`, commit_tx: "0x1", commit_pending: false, simulated: false,
    });
    expect(bodies[0]!.replace(/https?:\/\/\S+/g, "x".repeat(23)).length).toBeLessThanOrEqual(280);
    expect(bodies[0]).toContain("https://nightshift-signals.app/b/bkt_1");
  });
});

describe("Telegram Mini App", () => {
  const token = "123456:ABC-test-token";
  async function signed(fields: Record<string, string>) {
    const { createHmac } = await import("node:crypto");
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
  }

  it("accepts genuine init data and reads the user and start parameter", async () => {
    const { verifyTelegramInitData } = await import("./notify/telegram-webapp");
    const data = await signed({ auth_date: "1761100000", user: JSON.stringify({ id: 42, username: "night_owl", language_code: "hi" }), start_param: "bkt_20261022_0646_abc" });
    expect(verifyTelegramInitData(data, token, { now: 1761100100 })).toEqual({
      user: { id: 42, username: "night_owl", language_code: "hi" },
      startParam: "bkt_20261022_0646_abc",
    });
  });

  it("rejects tampered, wrongly signed or stale data", async () => {
    const { verifyTelegramInitData } = await import("./notify/telegram-webapp");
    const data = await signed({ auth_date: "1761100000", user: JSON.stringify({ id: 42 }) });
    expect(verifyTelegramInitData(data.replace("42", "43"), token, { now: 1761100100 })).toBeNull();
    expect(verifyTelegramInitData(data, "999:other", { now: 1761100100 })).toBeNull();
    expect(verifyTelegramInitData(data, token, { now: 1761100000 + 2 * 86_400 })).toBeNull();
  });

  it("adds an Open button into the Mini App on basket posts", async () => {
    const { TelegramNotifier } = await import("./notify/telegram.js");
    const bodies: { reply_markup?: { inline_keyboard: { url: string }[][] } }[] = [];
    const fake = (async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), new Response("{}"))) as unknown as typeof fetch;
    await new TelegramNotifier("T", "@c", fake, "https://t.me/flashbot/app").publishBasket({
      basket_id: "bkt_1", url: "u", headline: "h", thesis: "t", thesis_i18n: {}, severity: 4, category: null, legs: [], confidence: 0.5,
      canonical_hash: `0x${"ab".repeat(32)}`, commit_tx: null, commit_pending: false, simulated: true,
    });
    expect(bodies[0]!.reply_markup!.inline_keyboard[0]![0]!.url).toBe("https://t.me/flashbot/app?startapp=bkt_1");
  });
});

describe("lock-screen tracking", () => {
  const state = { status: "graded" as const, retPct: 1.25, vsSpyPct: 0.4, legs: [{ ticker: "XLE", chgPct: 2.1 }], updatedAt: 1761140700 };

  it("builds the ActivityKit payload with content-state, end alert and dismissal date", async () => {
    const { liveActivityPayload } = await import("./notify/live-activity");
    expect(liveActivityPayload("end", state, { dismissAt: 1761155100 })).toEqual({
      aps: {
        timestamp: 1761140700,
        event: "end",
        "content-state": state,
        "dismissal-date": 1761155100,
        alert: { title: "Nightshift Signals", body: "Your basket closed +1.25% at the open, +0.40% vs SPY." },
      },
    });
    const upd = liveActivityPayload("update", { ...state, status: "tracking" }, { staleAt: 1761141600 });
    expect(upd.aps).not.toHaveProperty("alert");
    expect(upd.aps["stale-date"]).toBe(1761141600);
  });

  it("signs the APNs provider token with ES256, key id and team id, and reuses it", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { decodeJwt, decodeProtectedHeader } = await import("jose");
    const { ApnsLiveActivitySender } = await import("./notify/live-activity");
    const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const apns = new ApnsLiveActivitySender({ teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem, bundleId: "com.example.app", production: false });
    const t = await apns.authToken(1_761_140_700_000);
    expect(decodeProtectedHeader(t)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decodeJwt(t)).toEqual({ iss: "TEAM123456", iat: 1761140700 });
    expect(await apns.authToken(1_761_140_700_000 + 10 * 60_000)).toBe(t);
  });

  it("treats DeviceNotRegistered from Expo as gone", async () => {
    const { ExpoLivePushSender } = await import("./notify/live-activity");
    const sent: unknown[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }));
    }) as unknown as typeof fetch;
    const r = await new ExpoLivePushSender(null, fake).send({ platform: "android", pushToken: "ExponentPushToken[x]", basketId: "bkt_1" }, "update", state);
    expect(r).toBe("gone");
    expect((sent[0] as { data: { kind: string } }[])[0]!.data.kind).toBe("nightshift-signals.live");
  });
});
