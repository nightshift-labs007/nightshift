import type { PushPayload, PushSender, PushTarget } from "@nightshift-signals/adapters";
import { makeEvent, newId, type Envelope } from "@nightshift-signals/core";
import { baskets, briefs, categoryOverrides, eq, events, grades, positions, pushSubscriptions, sources, triggers, users } from "@nightshift-signals/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeBriefs } from "./brief";
import { reviewCategories } from "./market/categories";
import { TickRecorder } from "./market/prices";
import { registerPipeline } from "./pipeline";
import { PushNotifier } from "./push";
import { publishMorningScorecard } from "./scorecard";
import { onDrift } from "./stages/alerts";
import { gradeDay } from "./stages/grade";
import { pollAllSources } from "./stages/ingest";
import { onEventTriaged } from "./stages/map";
import { makeTestDeps, rawHeadline } from "./testing";

class FakeSender implements PushSender {
  sent: { endpoint: string; payload: PushPayload }[] = [];
  gone = new Set<string>();
  async send(t: PushTarget, payload: PushPayload) {
    if (this.gone.has(t.endpoint)) return "gone" as const;
    this.sent.push({ endpoint: t.endpoint, payload });
    return "ok" as const;
  }
}

const t = await makeTestDeps(new Date("2026-10-22T06:00:00Z"));
const { deps, bus, news, market } = t;
const sender = new FakeSender();
deps.notifiers.push(new PushNotifier(deps.db, sender, deps.appUrl, deps.now));
const wire = { id: newId("source"), kind: "rss" as const, name: "Wire", url: "https://w.example/rss" };
const alice = newId("user");
const sub = (endpoint: string, extra: Partial<typeof pushSubscriptions.$inferInsert> = {}) => ({
  id: newId("push"),
  endpoint,
  p256dh: "k",
  auth: "a",
  ...extra,
});
const recorder = new TickRecorder(deps);
let basketId = "";

beforeAll(async () => {
  await deps.db.insert(sources).values(wire);
  await t.seedTokens();
  await deps.db.insert(users).values({ id: alice, email: "alice@example.com", handle: "alice" });
  await deps.db.insert(pushSubscriptions).values([
    sub("https://push/alice", { userId: alice, tz: "Asia/Kolkata", drift: true }),
    sub("https://push/anon-quiet", { quietStart: 0, quietEnd: 23, tz: "UTC" }),
    sub("https://push/severity5", { minSeverity: 5 }),
    sub("https://push/revoked"),
  ]);
  sender.gone.add("https://push/revoked");
  await deps.db.insert(triggers).values({
    id: newId("trigger"),
    userId: alice,
    nlText: "oil shocks",
    compiledRule: { categories: ["geopolitics_energy"], min_severity: 3, entities: [], regions: [] },
    channels: ["push"],
  });
  registerPipeline(deps);
  await recorder.record({ symbol: "SPY", px: "600", src: "dex", ts: deps.now() });
  news.feeds.set(wire.url, [rawHeadline("Tanker attacked in Strait of Hormuz", "r-1")]);
  await pollAllSources(deps);
  await bus.idle();
  basketId = (bus.published.find((e) => e.type === "basket.published") as Envelope<"basket.published">).payload.basket_id;
});
afterAll(() => t.close());

describe("web push", () => {
  it("sends the basket to matching subscribers at once, skipping quiet hours and drops revoked ones", () => {
    const basketPushes = sender.sent.filter((s) => s.payload.tag === basketId).map((s) => s.endpoint);
    expect(basketPushes).toEqual(["https://push/alice"]);
  });

  it("delivers a plain-English trigger match as a push", () => {
    expect(sender.sent.some((s) => s.endpoint === "https://push/alice" && s.payload.body.includes("oil shocks"))).toBe(true);
  });

  it("removes subscriptions the browser revoked", async () => {
    const left = await deps.db.select().from(pushSubscriptions);
    expect(left.map((s) => s.endpoint)).not.toContain("https://push/revoked");
  });

  it("pushes drift alerts only to subscribers who asked", async () => {
    sender.sent = [];
    await onDrift(deps, makeEvent("alert.drift", { symbol: "XLE", px: "103", fv: "101", gap_bps: 198, frozen: false, ts: deps.now().toISOString() }, { producer: "t", correlation_id: "XLE" }));
    expect(sender.sent.map((s) => s.endpoint)).toEqual(["https://push/alice"]);
  });
});

describe("paper league and personal receipts", () => {
  it("grades a tracked position on its own entries and sends its holder a receipt at 9:45", async () => {
    const [b] = await deps.db.select().from(baskets).where(eq(baskets.id, basketId));
    await deps.db.insert(positions).values({
      id: newId("position"),
      userId: alice,
      basketId,
      sizeUsdg: "100",
      entries: [{ token_symbol: "XLE", quote_price: "100", quote_size_usdg: "100", clicked_at: deps.now().toISOString() }],
    });
    expect(b?.status).toBe("published");

    t.advance(7 * 3600_000 + 45 * 60_000);
    market.prices.set("XLE", 103);
    await recorder.record({ symbol: "SPY", px: "601", src: "dex", ts: deps.now() });
    sender.sent = [];
    const summary = await gradeDay(deps, "2026-10-22");
    await publishMorningScorecard(deps, summary);

    const [p] = await deps.db.select().from(positions).where(eq(positions.userId, alice));
    expect(Number(p!.gradedRetPct)).toBeGreaterThan(0.025); // own entry at 100, exit ~103 less slippage
    const receipt = sender.sent.find((s) => s.endpoint === "https://push/alice");
    expect(receipt?.payload.title).toMatch(/^Your basket closed \+/);

    // The morning brief: one per language, template when the model gives nothing usable, audio from TTS.
    deps.tts = { synthesize: async (text: string) => ({ audio: Buffer.from(`mp3:${text.length}`), mime: "audio/mpeg" }) };
    await makeBriefs(deps, summary);
    const rows = await deps.db.select().from(briefs);
    expect(rows.map((r) => r.lang).sort()).toEqual(["en", "es", "hi"]);
    expect(rows.every((r) => r.source === "template" && r.audio !== null)).toBe(true);
    deps.tts = null;
  });
});

describe("category auto-disable", () => {
  it("disables a category after four losing weeks and the mapper then skips it", async () => {
    const g = (await deps.db.select().from(grades))[0]!;
    const [b] = await deps.db.select().from(baskets).where(eq(baskets.id, g.basketId));
    // Clone the graded basket into four earlier weeks, all misses.
    for (let w = 1; w <= 4; w++) {
      const id = `bkt_2026100${w}_0600_w${w}`;
      const ev = newId("event");
      await deps.db.insert(events).values({ id: ev, title: "old", firstSeenAt: deps.now(), category: "geopolitics_energy", severity: 4, triagedAt: deps.now() });
      await deps.db.insert(baskets).values({ ...b!, id, eventId: ev, status: "graded" });
      await deps.db.insert(grades).values({ ...g, basketId: id, hit: false, gradedAt: new Date(deps.now().getTime() - w * 7 * 86_400_000) });
    }
    expect(await reviewCategories(deps)).toEqual(["geopolitics_energy"]);
    const [o] = await deps.db.select().from(categoryOverrides);
    expect(o?.reason).toMatch(/4 straight weeks/);

    const ev = newId("event");
    await deps.db.insert(events).values({ id: ev, title: "Another tanker", firstSeenAt: deps.now() });
    const before = bus.published.filter((e) => e.type === "basket.proposed").length;
    await onEventTriaged(deps, makeEvent("event.triaged", { event_id: ev, is_market_moving: true, category: "geopolitics_energy", severity: 5, regions: [], entities: [], corroborated: false }, { producer: "t", correlation_id: ev }));
    expect(bus.published.filter((e) => e.type === "basket.proposed").length).toBe(before);
  });
});

describe("lock-screen tracking", () => {
  it("updates a tracker at most once a minute, then ends it with the graded result", async () => {
    const { LiveActivityService } = await import("./live");
    const { liveActivities } = await import("@nightshift-signals/db");
    const sent: { event: string; state: { status: string; retPct: number } }[] = [];
    const svc = new LiveActivityService(deps, { send: async (_t, event, state) => (sent.push({ event, state }), "ok" as const) });
    t.advance(-7 * 3600_000); // back to overnight
    for (const s of ["XLE", "GLD", "ITA", "SMH"]) market.prices.set(s, 100);
    await recorder.record({ symbol: "SPY", px: "600", src: "dex", ts: deps.now() }); // the live poller does this every 30 s
    news.feeds.set(wire.url, [rawHeadline("US widens export curbs on AI chips", "live-1")]);
    await pollAllSources(deps);
    await bus.idle();
    const id = (bus.published.filter((e) => e.type === "basket.published").at(-1) as Envelope<"basket.published">).payload.basket_id;
    await deps.db.insert(liveActivities).values({ id: newId("liveActivity"), userId: alice, basketId: id, platform: "ios", pushToken: "apns-token-1" });

    const [leg] = await deps.db.select().from((await import("@nightshift-signals/db")).basketLegs).where(eq((await import("@nightshift-signals/db")).basketLegs.basketId, id));
    const tick = (px: string) => makeEvent("price.tick", { symbol: leg!.tokenSymbol, px, src: "dex", ts: deps.now().toISOString() }, { producer: "t", correlation_id: "x" });
    for (const l of await deps.db.select().from((await import("@nightshift-signals/db")).basketLegs).where(eq((await import("@nightshift-signals/db")).basketLegs.basketId, id))) {
      await recorder.record({ symbol: l.tokenSymbol, px: l.entryQuotePrice, src: "dex", ts: deps.now() });
    }
    await svc.onTick(tick("101"));
    await svc.onTick(tick("102")); // within a minute: throttled
    expect(sent.map((s) => s.event)).toEqual(["update"]);
    t.advance(61_000);
    await svc.onTick(tick("102"));
    expect(sent.map((s) => s.event)).toEqual(["update", "update"]);

    t.advance(7 * 3600_000);
    await recorder.record({ symbol: "SPY", px: "602", src: "dex", ts: deps.now() });
    const summary = await gradeDay(deps, "2026-10-22");
    for (const g of summary.graded) {
      await svc.onGraded(makeEvent("basket.graded", { basket_id: g, ret_pct: "0", vs_spy_pct: "0", hit: false, graded_at: deps.now().toISOString() }, { producer: "t", correlation_id: g }));
    }
    expect(sent.at(-1)).toMatchObject({ event: "end", state: { status: "graded" } });
    const [a] = await deps.db.select().from(liveActivities).where(eq(liveActivities.pushToken, "apns-token-1"));
    expect(a?.endedAt).not.toBeNull();
  });
});
