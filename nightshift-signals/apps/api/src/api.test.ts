import { MemoryRateLimiter } from "@nightshift-signals/adapters";
import { OfflineDemoModel } from "@nightshift-signals/ai";
import { loadTaxonomy } from "@nightshift-signals/core/taxonomy";
import { gradeBasket, newId } from "@nightshift-signals/core";
import { baskets, eq, FairValueService, sources } from "@nightshift-signals/db";
import { TickRecorder } from "@nightshift-signals/worker/market/prices";
import { registerPipeline } from "@nightshift-signals/worker/pipeline";
import { gradeDay } from "@nightshift-signals/worker/grade";
import { makeTestDeps, rawHeadline } from "@nightshift-signals/worker/testing";
import { pollAllSources } from "@nightshift-signals/worker/ingest";
import type { AddressInfo } from "node:net";
import { keccak256, toBytes } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp } from "./app";
import type { ApiContext } from "./context";
import { startApi } from "./server";

const t = await makeTestDeps(new Date("2026-10-22T06:00:00Z"));
const { deps, bus, news } = t;
const wire = { id: newId("source"), kind: "rss" as const, name: "Wire", url: "https://w.example/rss" };
const ctx: ApiContext = {
  db: deps.db,
  bus,
  prices: deps.prices,
  fairValue: new FairValueService(deps.db, deps.prices, deps.now),
  quotes: t.market,
  model: new OfflineDemoModel(loadTaxonomy),
  rateLimiter: new MemoryRateLimiter(),
  mode: "local",
  jwtSecret: new TextEncoder().encode("x".repeat(32)),
  maxSlipBps: 80,
  vapidPublicKey: "BPublicKeyForTests",
  telegram: { botToken: "123:TEST", webhookSecret: "s3cret", appUrl: "https://nightshift-signals.test" },
  links: { chainSlug: null, usdgAddress: null },
  now: deps.now,
};
const app = createApp(ctx);
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers: { "x-forwarded-for": "10.0.0.1", ...headers } });
let basketId = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

beforeAll(async () => {
  await deps.db.insert(sources).values(wire);
  await t.seedTokens();
  registerPipeline(deps);
  await new TickRecorder(deps).record({ symbol: "SPY", px: "600", src: "dex", ts: deps.now() });
  news.feeds.set(wire.url, [rawHeadline("Tanker attacked in Strait of Hormuz", "a-1")]);
  await pollAllSources(deps);
  await bus.idle();
  basketId = (bus.published.find((e) => e.type === "basket.published")!.payload as { basket_id: string }).basket_id;
});
afterAll(() => t.close());

describe("REST", () => {
  it("serves the feed with the published basket", async () => {
    const f = await body(get("/v1/feed"));
    expect(f.items[0].event.title).toBe("Tanker attacked in Strait of Hormuz");
    expect(f.items[0].basket).toMatchObject({ id: basketId, status: "published", simulated: true });
  });

  it("never serves a draft basket", async () => {
    await deps.db.update(baskets).set({ status: "draft", publishedAt: null }).where(eq(baskets.id, basketId));
    expect((await get(`/v1/baskets/${basketId}`)).status).toBe(404);
    const feed = await body(get("/v1/feed"));
    expect(feed.items[0].basket).toBeNull();
    await deps.db.update(baskets).set({ status: "published", publishedAt: deps.now() }).where(eq(baskets.id, basketId));
  });

  it("serves the basket with its proof and live legs, and the exact canonical JSON", async () => {
    const d = await body(get(`/v1/baskets/${basketId}`));
    expect(d.commit).toMatchObject({ simulated: true, status: "confirmed" });
    expect(d.live).toHaveLength(d.basket.legs.length);
    const canonical = await (await get(`/v1/baskets/${basketId}/canonical`)).text();
    expect(keccak256(toBytes(canonical))).toBe(d.basket.canonical_hash);
  });

  it("quotes a size per leg and flags legs over the slippage cap", async () => {
    const small = await body(get(`/v1/baskets/${basketId}/quote?usdg=100`));
    expect(small.legs.every((l: { over_cap: boolean }) => !l.over_cap)).toBe(true);
    const huge = await body(get(`/v1/baskets/${basketId}/quote?usdg=500000`));
    expect(huge.legs.every((l: { over_cap: boolean }) => l.over_cap)).toBe(true);
  });

  it("blocks trade links for US users before building them", async () => {
    expect((await get(`/v1/baskets/${basketId}/links?usdg=100`, { "x-vercel-ip-country": "US" })).status).toBe(451);
    const ok = await body(get(`/v1/baskets/${basketId}/links?usdg=100`, { "x-vercel-ip-country": "IN" }));
    expect(ok.simulated).toBe(true);
    expect(ok.links.map((l: { usdg: string }) => l.usdg)).toEqual(["50.00", "50.00"]);
    expect(ok.links[0].url).toBeNull(); // simulated tokens never get a real swap link
  });

  it("publishes a scorecard and a CSV that recomputes exactly", async () => {
    t.advance(7 * 3600_000 + 45 * 60_000);
    await new TickRecorder(deps).record({ symbol: "SPY", px: "601", src: "dex", ts: deps.now() });
    await gradeDay(deps, "2026-10-22");
    const s = await body(get("/v1/scorecard"));
    expect(s.summary.graded).toBe(1);
    const csv = await (await get("/v1/scorecard.csv")).text();
    const [header, ...lines] = csv.trim().split("\n");
    const cols = header!.split(",");
    const rows = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
    const g = gradeBasket(
      rows.map((r) => ({ token_symbol: r.token_symbol!, weight: Number(r.weight), entry_quote_price: r.entry_quote_price!, exit_price: r.exit_price!, exit_open_print: null })),
      { entry: rows[0]!.spy_entry!, exit: rows[0]!.spy_exit! },
    );
    expect(g.vs_spy_pct).toBe(rows[0]!.vs_spy_pct);
    expect(String(g.hit)).toBe(rows[0]!.hit);
    const morning = await body(get("/v1/scorecard/2026-10-22"));
    expect(morning.rows).toHaveLength(1);
  });

  it("documents itself", async () => {
    const doc = await body(get("/v1/openapi.json"));
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/v1/feed", "/v1/baskets/{id}", "/v1/scorecard", "/v1/me/triggers"]));
  });

  it("rate-limits public endpoints at 60 a minute per IP", async () => {
    const statuses = [];
    for (let i = 0; i < 61; i++) statuses.push((await get("/health", {})).status, (await get("/v1/fairvalue", { "x-forwarded-for": "10.9.9.9" })).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });
});

describe("/me", () => {
  it("compiles a plain-English trigger, then saves it on confirm, and logs paper positions", async () => {
    const { token } = await body(app.request("/v1/auth/local", { method: "POST", body: JSON.stringify({ email: "a@b.co" }), headers: { "content-type": "application/json" } }));
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    expect((await app.request("/v1/me/triggers")).status).toBe(401);

    const preview = await body(app.request("/v1/me/triggers", { method: "POST", headers: auth, body: JSON.stringify({ text: "Ping me on chip export news above severity 3" }) }));
    expect(preview.saved).toBeNull();
    const saved = await body(app.request("/v1/me/triggers", { method: "POST", headers: auth, body: JSON.stringify({ text: "chips", confirm: true, rule: preview.rule }) }));
    expect(saved.saved.id).toMatch(/^trg_/);

    const pos = await app.request("/v1/me/positions", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ basket_id: basketId, size_usdg: "100", entries: [{ token_symbol: "XLE", quote_price: "100", quote_size_usdg: "50" }] }),
    });
    expect(pos.status).toBe(200);
    await new TickRecorder(deps).record({ symbol: "XLE", px: "101", src: "dex", ts: deps.now() });
    const list = await body(app.request("/v1/me/positions", { headers: auth }));
    expect(list.items[0].legs[0].pnl_pct).toBe(1);
  });
});

describe("follow or fade, league, push, replay", () => {
  it("records votes until 30 minutes after publish, then locks", async () => {
    const { token } = await body(app.request("/v1/auth/local", { method: "POST", body: JSON.stringify({ email: "v@b.co" }), headers: { "content-type": "application/json" } }));
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const [b] = await deps.db.select().from(baskets).where(eq(baskets.id, basketId));
    await deps.db.update(baskets).set({ publishedAt: new Date(deps.now().getTime() - 10 * 60_000) }).where(eq(baskets.id, basketId));
    expect((await app.request(`/v1/baskets/${basketId}/vote`, { method: "POST", headers: auth, body: JSON.stringify({ vote: "fade" }) })).status).toBe(200);
    const v = await body(app.request(`/v1/baskets/${basketId}/votes`, { headers: auth }));
    expect(v).toMatchObject({ fade: 1, follow: 0, call: "fade", open: true, mine: "fade" });
    await deps.db.update(baskets).set({ publishedAt: new Date(deps.now().getTime() - 31 * 60_000) }).where(eq(baskets.id, basketId));
    expect((await app.request(`/v1/baskets/${basketId}/vote`, { method: "POST", headers: auth, body: JSON.stringify({ vote: "follow" }) })).status).toBe(409);
    await deps.db.update(baskets).set({ publishedAt: b!.publishedAt }).where(eq(baskets.id, basketId));

    const crowd = await body(get("/v1/scorecard/crowd"));
    expect(crowd.rows[0]).toMatchObject({ crowd: "fade" });
    expect(crowd.rows[0].crowd_hit).toBe(!crowd.rows[0].ai_hit);
  });

  it("serves the weekly league with handles and the paper-only rules", async () => {
    const league = await body(get("/v1/league"));
    expect(league.rules).toMatch(/No money/);
    expect(Array.isArray(league.rows)).toBe(true);
  });

  it("stores a push subscription with its preferences", async () => {
    expect((await body(get("/v1/push/key"))).key).toBe("BPublicKeyForTests");
    const res = await app.request("/v1/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }, min_severity: 4, quiet_start: 23, quiet_end: 7, tz: "Asia/Kolkata", lang: "hi" }),
    });
    expect(res.status).toBe(200);
    const { pushSubscriptions } = await import("@nightshift-signals/db");
    const [s] = await deps.db.select().from(pushSubscriptions);
    expect(s).toMatchObject({ minSeverity: 4, quietStart: 23, lang: "hi", userId: null });
  });

  it("serves the morning brief script and its audio", async () => {
    const { briefs } = await import("@nightshift-signals/db");
    await deps.db.insert(briefs).values({ date: "2026-10-22", lang: "hi", script: "नमस्ते", source: "template", audio: Buffer.from("ID3"), audioMime: "audio/mpeg" });
    expect(await body(get("/v1/brief/latest?lang=hi"))).toEqual({ date: "2026-10-22" });
    const b = await body(get("/v1/brief/2026-10-22?lang=hi"));
    expect(b).toMatchObject({ script: "नमस्ते", audio_url: "/v1/brief/2026-10-22/audio?lang=hi" });
    const audio = await get(b.audio_url);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
    expect(await audio.text()).toBe("ID3");
  });

  it("serves a night for replay with events, baskets and 5-minute series", async () => {
    const r = await body(get("/v1/replay/2026-10-22"));
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.baskets[0].legs.length).toBeGreaterThan(0);
    expect(Object.keys(r.series)).toContain("SPY");
    expect((await get("/v1/replay/2026-10-24")).status).toBe(400); // Saturday
  });
});

describe("lock-screen tracking registration", () => {
  it("registers a tracker for a published basket and refuses graded ones", async () => {
    const { token } = await body(app.request("/v1/auth/local", { method: "POST", body: JSON.stringify({ email: "m@b.co" }), headers: { "content-type": "application/json" } }));
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const [b] = await deps.db.select().from(baskets).where(eq(baskets.id, basketId));
    const res = await app.request("/v1/me/live-activities", { method: "POST", headers: auth, body: JSON.stringify({ basket_id: basketId, platform: "ios", push_token: "apns-abcdef" }) });
    expect(res.status).toBe(b!.status === "published" ? 200 : 409);
    expect((await app.request("/v1/me/live-activities", { method: "POST", body: JSON.stringify({}) })).status).toBe(401);
  });
});

describe("Telegram", () => {
  it("signs in a Mini App user from verified init data, once per Telegram id", async () => {
    const { createHmac } = await import("node:crypto");
    const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 777, username: "tg_trader", language_code: "es" }) };
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update("123:TEST").digest();
    const init_data = new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
    const post = () => app.request("/v1/auth/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data }) });
    const a = await body(post());
    const b = await body(post());
    expect(a.user_id).toBe(b.user_id);
    const { users } = await import("@nightshift-signals/db");
    const [u] = await deps.db.select().from(users).where(eq(users.id, a.user_id));
    expect(u).toMatchObject({ telegramId: 777, lang: "es", handle: "tg_trader" });
    const forged = init_data.replace("777", "778");
    expect((await app.request("/v1/auth/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: forged }) })).status).toBe(401);
  });

  it("rejects webhook calls without the secret token", async () => {
    const res = await app.request("/v1/telegram/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
  });
});

describe("WebSocket", () => {
  it("sends a snapshot, then sequenced deltas; refuses another user's channel", async () => {
    const { server, gateway } = startApi(ctx, 0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const msgs: { type: string; channel?: string; seq?: number; event?: string; error?: string }[] = [];
    ws.on("message", (m) => msgs.push(JSON.parse(String(m))));
    await new Promise((r) => ws.once("open", r));

    ws.send(JSON.stringify({ op: "subscribe", channel: "feed" }));
    ws.send(JSON.stringify({ op: "subscribe", channel: "user:usr_01JB8Z3Q5X6C7V8B9N0M1K2J3H" }));
    await until(() => msgs.length >= 2);
    expect(msgs.find((m) => m.type === "snapshot")?.channel).toBe("feed");
    expect(msgs.find((m) => m.type === "error")?.error).toBe("unauthorized");

    t.advance(-7 * 3600_000);
    news.feeds.set(wire.url, [rawHeadline("US widens export curbs on AI chips to China", "a-2")]);
    await pollAllSources(deps);
    await bus.idle();
    await until(() => msgs.some((m) => m.event === "basket.published"));
    const seqs = msgs.filter((m) => m.type === "delta" && m.channel === "feed").map((m) => m.seq!);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    ws.close();
    gateway.close();
    server.close();
  });
});

async function until(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
