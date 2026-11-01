import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { addDays, CATEGORIES, crowdHit, etToUtc, isTradingDay, lastClose, leaderboard, leagueWeek, newId, tally, voteOpen, VOTES } from "@nightshift-signals/core";
import {
  and, asc, basketLegs, baskets, briefs, desc, eq, events, grades, gte, inArray, isNotNull, lt, lte, positions, priceBars1m, pushSubscriptions, users, votes,
} from "@nightshift-signals/db";
import { verifyUserToken } from "../auth";
import type { ApiContext, Env } from "../context";
import { ErrorBody } from "../schemas";

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const REPLAY_BAR_MINUTES = 5;

export function socialRoutes(ctx: ApiContext) {
  const app = new OpenAPIHono<Env>();
  const userOf = (h: string | undefined) => verifyUserToken(ctx, h?.replace(/^Bearer /i, ""));

  // Follow or fade

  app.get("/baskets/:id/votes", async (c) => {
    const id = c.req.param("id");
    const [b] = await ctx.db.select({ publishedAt: baskets.publishedAt }).from(baskets).where(and(eq(baskets.id, id), isNotNull(baskets.publishedAt)));
    if (!b) return c.json({ error: "not found" }, 404);
    const rows = await ctx.db.select({ vote: votes.vote, userId: votes.userId }).from(votes).where(eq(votes.basketId, id));
    const me = await userOf(c.req.header("authorization"));
    return c.json({
      ...tally(rows.map((r) => r.vote)),
      open: voteOpen(b.publishedAt!, ctx.now()),
      closes_at: new Date(b.publishedAt!.getTime() + 30 * 60_000).toISOString(),
      mine: rows.find((r) => r.userId === me)?.vote ?? null,
    });
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/baskets/{id}/vote",
      summary: "Follow or fade a basket; locked 30 minutes after publish. The crowd is graded like the AI.",
      security: [{ bearer: [] }],
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) }),
        body: { content: { "application/json": { schema: z.object({ vote: z.enum(VOTES) }) } } },
      },
      responses: { 200: json(z.object({ ok: z.boolean() }), "Recorded"), 401: json(ErrorBody, "Sign in"), 404: json(ErrorBody, "Not found"), 409: json(ErrorBody, "Voting closed") },
    }),
    async (c) => {
      const userId = await userOf(c.req.header("authorization"));
      if (!userId) return c.json({ error: "sign in required" }, 401);
      const { id } = c.req.valid("param");
      const [b] = await ctx.db.select({ publishedAt: baskets.publishedAt }).from(baskets).where(and(eq(baskets.id, id), isNotNull(baskets.publishedAt)));
      if (!b) return c.json({ error: "not found" }, 404);
      if (!voteOpen(b.publishedAt!, ctx.now())) return c.json({ error: "voting closed 30 minutes after publish" }, 409);
      const { vote } = c.req.valid("json");
      await ctx.db.insert(votes).values({ basketId: id, userId, vote }).onConflictDoUpdate({ target: [votes.basketId, votes.userId], set: { vote } });
      return c.json({ ok: true }, 200);
    },
  );

  /** Crowd vs AI on every graded basket the crowd called. */
  app.get("/scorecard/crowd", async (c) => {
    const rows = await ctx.db.select({ id: grades.basketId, hit: grades.hit }).from(grades);
    const vs = rows.length ? await ctx.db.select().from(votes).where(inArray(votes.basketId, rows.map((r) => r.id))) : [];
    const called = rows.flatMap((r) => {
      const t = tally(vs.filter((v) => v.basketId === r.id).map((v) => v.vote));
      const h = crowdHit(t.call, r.hit);
      return h === null ? [] : [{ basket_id: r.id, crowd: t.call, crowd_hit: h, ai_hit: r.hit, votes: t.follow + t.fade }];
    });
    const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
    return c.json({ baskets: called.length, crowd_hit_rate: rate(called.map((x) => x.crowd_hit)), ai_hit_rate: rate(called.map((x) => x.ai_hit)), rows: called });
  });

  // Paper league

  app.get("/league", async (c) => {
    const at = c.req.query("week") ? etToUtc(c.req.query("week")!, 12, 0) : ctx.now();
    const week = leagueWeek(at);
    const rows = await ctx.db
      .select({ user_id: positions.userId, graded_at: positions.gradedAt, pnl: positions.gradedPnlUsdg, vs: positions.gradedVsSpyPct })
      .from(positions)
      .where(and(gte(positions.gradedAt, week.start), lt(positions.gradedAt, week.end)));
    const board = leaderboard(rows.map((r) => ({ user_id: r.user_id, graded_at: r.graded_at!, pnl_usdg: r.pnl!, vs_spy_pct: r.vs! })));
    const names = board.length ? await ctx.db.select({ id: users.id, handle: users.handle }).from(users).where(inArray(users.id, board.map((b) => b.user_id))) : [];
    return c.json({
      week: week.label,
      rules: "Paper USDG only. No money, no prizes with monetary value. Positions are graded on your own logged entry quotes against the 9:45 ET exits.",
      rows: board.map((b, i) => ({ rank: i + 1, handle: names.find((n) => n.id === b.user_id)?.handle ?? `trader-${b.user_id.slice(-5).toLowerCase()}`, ...b, user_id: undefined })),
    });
  });

  app.put("/me", async (c) => {
    const userId = await userOf(c.req.header("authorization"));
    if (!userId) return c.json({ error: "sign in required" }, 401);
    const parsed = z.object({ handle: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/).optional(), lang: z.enum(["en", "hi", "es"]).optional() }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "handle: 3-20 letters, digits or _" }, 400);
    try {
      await ctx.db.update(users).set(parsed.data).where(eq(users.id, userId));
    } catch {
      return c.json({ error: "that handle is taken" }, 409);
    }
    return c.json({ ok: true });
  });

  // Morning voice brief

  app.get("/brief/latest", async (c) => {
    const lang = c.req.query("lang") ?? "en";
    const [b] = await ctx.db.select({ date: briefs.date }).from(briefs).where(eq(briefs.lang, lang)).orderBy(desc(briefs.date)).limit(1);
    return b ? c.json({ date: b.date }) : c.json({ error: "no brief yet" }, 404);
  });

  app.get("/brief/:date", async (c) => {
    const lang = c.req.query("lang") ?? "en";
    const [b] = await ctx.db.select().from(briefs).where(and(eq(briefs.date, c.req.param("date")), eq(briefs.lang, lang)));
    if (!b) return c.json({ error: "no brief for that day" }, 404);
    return c.json({ date: b.date, lang: b.lang, script: b.script, source: b.source, audio_url: b.audio ? `/v1/brief/${b.date}/audio?lang=${lang}` : null });
  });

  app.get("/brief/:date/audio", async (c) => {
    const [b] = await ctx.db.select().from(briefs).where(and(eq(briefs.date, c.req.param("date")), eq(briefs.lang, c.req.query("lang") ?? "en")));
    if (!b?.audio) return c.json({ error: "no audio" }, 404);
    c.header("content-type", b.audioMime ?? "audio/mpeg");
    c.header("cache-control", "public, max-age=86400");
    return c.body(new Uint8Array(b.audio));
  });

  // Web Push

  app.get("/push/key", (c) => (ctx.vapidPublicKey ? c.json({ key: ctx.vapidPublicKey }) : c.json({ error: "push not configured" }, 404)));

  app.post("/push/subscribe", async (c) => {
    const body = z
      .object({
        subscription: z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }),
        min_severity: z.number().int().min(0).max(5).default(3),
        categories: z.array(z.enum(CATEGORIES)).default([]),
        drift: z.boolean().default(false),
        receipts: z.boolean().default(true),
        quiet_start: z.number().int().min(0).max(23).nullable().default(null),
        quiet_end: z.number().int().min(0).max(23).nullable().default(null),
        tz: z.string().max(64).default("UTC"),
        lang: z.enum(["en", "hi", "es"]).default("en"),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);
    const b = body.data;
    const prefs = {
      userId: await userOf(c.req.header("authorization")),
      p256dh: b.subscription.keys.p256dh,
      auth: b.subscription.keys.auth,
      minSeverity: b.min_severity,
      categories: b.categories,
      drift: b.drift,
      receipts: b.receipts,
      quietStart: b.quiet_start,
      quietEnd: b.quiet_end,
      tz: b.tz,
      lang: b.lang,
      failures: 0,
    };
    await ctx.db
      .insert(pushSubscriptions)
      .values({ id: newId("push"), endpoint: b.subscription.endpoint, ...prefs })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: prefs });
    return c.json({ ok: true });
  });

  app.delete("/push/subscribe", async (c) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
    await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return c.json({ ok: true });
  });

  // Night Replay: one night, 16:00 ET to 9:45 ET, every event and basket with its legs' 5-minute prices.

  app.get("/replay/:date", async (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isTradingDay(date)) return c.json({ error: "not a trading day" }, 400);
    const end = etToUtc(date, 9, 45);
    const start = lastClose(new Date(etToUtc(date, 9, 30).getTime() - 60_000));
    const evs = await ctx.db
      .select()
      .from(events)
      .where(and(gte(events.firstSeenAt, start), lt(events.firstSeenAt, end), isNotNull(events.triagedAt), gte(events.severity, 2)))
      .orderBy(asc(events.firstSeenAt));
    const bs = evs.length
      ? await ctx.db
          .select({ b: baskets, g: grades })
          .from(baskets)
          .leftJoin(grades, eq(grades.basketId, baskets.id))
          .where(and(inArray(baskets.eventId, evs.map((e) => e.id)), isNotNull(baskets.publishedAt)))
      : [];
    const legs = bs.length ? await ctx.db.select().from(basketLegs).where(inArray(basketLegs.basketId, bs.map((x) => x.b.id))) : [];
    const symbols = [...new Set([...legs.map((l) => l.tokenSymbol), "SPY"])];
    const bars = await ctx.db
      .select({ symbol: priceBars1m.symbol, ts: priceBars1m.ts, c: priceBars1m.c })
      .from(priceBars1m)
      .where(and(inArray(priceBars1m.symbol, symbols), gte(priceBars1m.ts, start), lte(priceBars1m.ts, end)))
      .orderBy(asc(priceBars1m.ts));
    // Downsample to 5-minute closes to keep the payload small.
    const series: Record<string, [number, number][]> = {};
    for (const b of bars) {
      const slot = Math.floor(b.ts.getTime() / (REPLAY_BAR_MINUTES * 60_000)) * REPLAY_BAR_MINUTES * 60_000;
      const s = (series[b.symbol] ??= []);
      if (s.at(-1)?.[0] === slot) s[s.length - 1] = [slot, Number(b.c)];
      else s.push([slot, Number(b.c)]);
    }
    return c.json({
      date,
      start: start.toISOString(),
      end: end.toISOString(),
      prev: prevTradingDay(date),
      next: nextTradingDay(date),
      events: evs.map((e) => ({ id: e.id, title: e.title, at: e.firstSeenAt.toISOString(), severity: e.severity, category: e.category })),
      baskets: bs.map(({ b, g }) => ({
        id: b.id,
        event_id: b.eventId,
        thesis: b.thesis,
        published_at: b.publishedAt!.toISOString(),
        status: b.status,
        legs: legs.filter((l) => l.basketId === b.id).sort((x, y) => x.position - y.position).map((l) => ({ symbol: l.tokenSymbol, ticker: l.underlyingTicker, weight: Number(l.weight), entry: l.entryQuotePrice })),
        grade: g ? { vs_spy_pct: g.vsSpyPct, ret_pct: g.retPct, hit: g.hit } : null,
      })),
      series,
    });
  });

  return app;
}

function prevTradingDay(date: string) {
  let d = addDays(date, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}
function nextTradingDay(date: string) {
  let d = addDays(date, 1);
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}

