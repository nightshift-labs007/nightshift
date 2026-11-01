import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { compileTrigger } from "@nightshift-signals/ai";
import { DELIVERY_CHANNELS, Decimal, moveBps, newId, TriggerRule } from "@nightshift-signals/core";
import { and, baskets, desc, eq, isNotNull, liveActivities, positions, sql, triggers, users } from "@nightshift-signals/db";
import type { ApiContext, Env } from "../context";
import { requireUser, signUserToken } from "../auth";
import { ErrorBody } from "../schemas";

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const security = [{ bearer: [] }];

export function meRoutes(ctx: ApiContext) {
  const app = new OpenAPIHono<Env>();

  if (ctx.mode === "local") {
    // Local only. Live sign-in goes through the embedded-wallet provider (Privy), which issues this same token.
    app.post("/auth/local", async (c) => {
      const { email } = z.object({ email: z.email() }).parse(await c.req.json());
      const [found] = await ctx.db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
      const id = found?.id ?? newId("user");
      if (!found) await ctx.db.insert(users).values({ id, email, lang: "en" });
      return c.json({ token: await signUserToken(ctx, id), user_id: id });
    });
  }

  app.use("/me/*", requireUser(ctx));
  app.use("/me", requireUser(ctx));

  app.get("/me", async (c) => {
    const [u] = await ctx.db.select().from(users).where(eq(users.id, c.get("userId")));
    return u ? c.json({ id: u.id, email: u.email, wallet: u.wallet, lang: u.lang, country: u.country, tier: u.tier }) : c.json({ error: "not found" }, 404);
  });

  const TriggerView = z.object({
    id: z.string(),
    nl_text: z.string(),
    compiled_rule: TriggerRule,
    channels: z.array(z.enum(DELIVERY_CHANNELS)),
    active: z.boolean(),
    created_at: z.string(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/me/triggers",
      summary: "Compile a plain-English alert; send confirm=true with the shown rule to save it",
      security,
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                text: z.string().min(3).max(500),
                channels: z.array(z.enum(DELIVERY_CHANNELS)).min(1).default(["ws"]),
                confirm: z.boolean().default(false),
                rule: TriggerRule.optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: json(z.object({ rule: TriggerRule, saved: TriggerView.nullable() }), "Compiled (and saved when confirmed)"),
        400: json(ErrorBody, "Could not compile"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      let rule;
      try {
        rule = body.confirm && body.rule ? body.rule : await compileTrigger(ctx.model, body.text);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
      if (!body.confirm) return c.json({ rule, saved: null }, 200);
      const [row] = await ctx.db
        .insert(triggers)
        .values({ id: newId("trigger"), userId: c.get("userId"), nlText: body.text, compiledRule: rule, channels: body.channels })
        .returning();
      return c.json({ rule, saved: triggerView(row!) }, 200);
    },
  );

  app.get("/me/triggers", async (c) => {
    const rows = await ctx.db.select().from(triggers).where(eq(triggers.userId, c.get("userId"))).orderBy(desc(triggers.createdAt));
    return c.json({ items: rows.map(triggerView) });
  });

  app.delete("/me/triggers/:id", async (c) => {
    await ctx.db.delete(triggers).where(and(eq(triggers.id, c.req.param("id")), eq(triggers.userId, c.get("userId"))));
    return c.json({ ok: true });
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/me/positions",
      summary: "Log the quote shown when the user tapped a trade link: their paper entry",
      security,
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                basket_id: z.string(),
                size_usdg: Decimal,
                entries: z.array(z.object({ token_symbol: z.string(), quote_price: Decimal, quote_size_usdg: Decimal })).min(1),
              }),
            },
          },
        },
      },
      responses: { 200: json(z.object({ id: z.string() }), "Logged") },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const clicked_at = ctx.now().toISOString();
      const id = newId("position");
      await ctx.db.insert(positions).values({
        id,
        userId: c.get("userId"),
        basketId: b.basket_id,
        sizeUsdg: b.size_usdg,
        entries: b.entries.map((e) => ({ ...e, clicked_at })),
      });
      return c.json({ id }, 200);
    },
  );

  // Lock-screen tracking: the app registers its Live Activity push token (iOS) or Expo push token (Android).
  app.post("/me/live-activities", async (c) => {
    const parsed = z
      .object({ basket_id: z.string(), platform: z.enum(["ios", "android"]), push_token: z.string().min(8).max(512) })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const b = parsed.data;
    const [basket] = await ctx.db.select({ status: baskets.status }).from(baskets).where(and(eq(baskets.id, b.basket_id), isNotNull(baskets.publishedAt)));
    if (!basket) return c.json({ error: "not found" }, 404);
    if (basket.status !== "published") return c.json({ error: "this basket is already graded" }, 409);
    await ctx.db
      .insert(liveActivities)
      .values({ id: newId("liveActivity"), userId: c.get("userId"), basketId: b.basket_id, platform: b.platform, pushToken: b.push_token })
      .onConflictDoUpdate({ target: [liveActivities.pushToken, liveActivities.basketId], set: { endedAt: null, userId: c.get("userId") } });
    return c.json({ ok: true });
  });

  app.delete("/me/live-activities", async (c) => {
    const { push_token } = z.object({ push_token: z.string() }).parse(await c.req.json());
    await ctx.db
      .update(liveActivities)
      .set({ endedAt: ctx.now() })
      .where(and(eq(liveActivities.pushToken, push_token), eq(liveActivities.userId, c.get("userId"))));
    return c.json({ ok: true });
  });

  app.get("/me/positions", async (c) => {
    const rows = await ctx.db.select().from(positions).where(eq(positions.userId, c.get("userId"))).orderBy(desc(positions.createdAt));
    const mids = await ctx.prices.getMany([...new Set(rows.flatMap((r) => r.entries.map((e) => e.token_symbol)))]);
    return c.json({
      items: rows.map((r) => {
        const legs = r.entries.map((e) => {
          const mid = mids.get(e.token_symbol)?.px ?? null;
          return { ...e, mid, pnl_pct: mid ? moveBps(mid, e.quote_price) / 100 : null };
        });
        const known = legs.filter((l) => l.pnl_pct !== null);
        const total = known.reduce((s, l) => s + Number(l.quote_size_usdg), 0);
        return {
          id: r.id,
          basket_id: r.basketId,
          size_usdg: r.sizeUsdg,
          created_at: r.createdAt.toISOString(),
          legs,
          pnl_pct: total ? known.reduce((s, l) => s + (l.pnl_pct! * Number(l.quote_size_usdg)) / total, 0) : null,
        };
      }),
    });
  });

  return app;
}

function triggerView(t: typeof triggers.$inferSelect) {
  return { id: t.id, nl_text: t.nlText, compiled_rule: t.compiledRule, channels: t.channels, active: t.active, created_at: t.createdAt.toISOString() };
}
