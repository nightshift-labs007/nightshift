import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { basketCanonicalJson, Basket, CATEGORIES, computeScorecard, etToUtc, legAmounts, moveBps, scorecardCsv, slippageBps, tradeLinksAllowed, uniswapSwapUrl, unitPrice } from "@nightshift-signals/core";
import { categoryOverrides, eq, tokens } from "@nightshift-signals/db";
import type { ApiContext, Env } from "../context";
import { BasketSummary, ErrorBody, EventView, FairValue, FeedItem, Headline, LiveLeg, QuoteLeg, ScorecardRow, ScorecardSummary, TradeLink } from "../schemas";
import { basketDetail, csvLegs, eventDetail, feed, scorecardRows } from "../views";

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const notFound = json(ErrorBody, "Not found or not yet published");
const BasketParams = z.object({ id: z.string().openapi({ param: { name: "id", in: "path" }, example: "bkt_20261021_0214_a" }) });
const ScorecardQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  sector: z.enum(CATEGORIES).optional(),
});

/** Edge geo headers (Vercel, Cloudflare); `x-country` for local testing. */
export function requestCountry(h: (name: string) => string | undefined): string | null {
  return h("x-vercel-ip-country") ?? h("cf-ipcountry") ?? h("x-country") ?? null;
}

export function publicRoutes(ctx: ApiContext) {
  const app = new OpenAPIHono<Env>();

  app.openapi(
    createRoute({
      method: "get",
      path: "/feed",
      summary: "Triaged events, newest first, with their published basket",
      request: {
        query: z.object({
          since: z.string().optional(),
          severity: z.coerce.number().int().min(0).max(5).default(2),
          sector: z.enum(CATEGORIES).optional(),
          region: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
      responses: { 200: json(z.object({ items: z.array(FeedItem) }), "Feed") },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const items = await feed(ctx.db, { since: q.since, minSeverity: q.severity, category: q.sector, region: q.region, limit: q.limit });
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/events/{id}",
      summary: "One story: its headlines and every basket generated for it",
      request: { params: BasketParams },
      responses: { 200: json(z.object({ event: EventView, headlines: z.array(Headline), baskets: z.array(BasketSummary) }), "Event"), 404: notFound },
    }),
    async (c) => {
      const d = await eventDetail(ctx.db, c.req.valid("param").id);
      return d ? c.json(d, 200) : c.json({ error: "not found" }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/baskets/{id}",
      summary: "A published basket with proof, grade, analogs and live legs",
      request: { params: BasketParams },
      responses: {
        200: json(
          z.object({
            basket: Basket,
            why_chain_i18n: z.record(z.string(), z.array(z.string())),
            event: EventView.nullable(),
            headlines: z.array(Headline),
            commit: z
              .object({
                hash: z.string(),
                tx_hash: z.string().nullable(),
                chain_id: z.number(),
                status: z.enum(["pending", "confirmed"]),
                block_number: z.number().nullable(),
                block_time: z.string().nullable(),
                simulated: z.boolean(),
              })
              .nullable(),
            grade: z.unknown().nullable(),
            analogs: z.array(z.object({ event: EventView, basket: BasketSummary.nullable() })),
            live: z.array(LiveLeg),
          }),
          "Basket",
        ),
        404: notFound,
      },
    }),
    async (c) => {
      const d = await basketDetail(ctx.db, c.req.valid("param").id);
      if (!d) return c.json({ error: "not found" }, 404);
      return c.json({ ...d, live: await liveLegs(ctx, d.basket) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/baskets/{id}/canonical",
      summary: "The exact canonical JSON whose keccak256 was committed onchain",
      request: { params: BasketParams },
      responses: { 200: { content: { "text/plain": { schema: z.string() } }, description: "Canonical JSON" }, 404: notFound },
    }),
    async (c) => {
      const d = await basketDetail(ctx.db, c.req.valid("param").id);
      if (!d) return c.json({ error: "not found" }, 404);
      return c.text(basketCanonicalJson(d.basket), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/baskets/{id}/quote",
      summary: "Live per-leg quote for a USDG size; legs over the slippage cap are flagged",
      request: { params: BasketParams, query: z.object({ usdg: z.coerce.number().positive().max(1_000_000).default(100) }) },
      responses: { 200: json(z.object({ usdg: z.number(), max_slip_bps: z.number(), legs: z.array(QuoteLeg) }), "Quote"), 404: notFound },
    }),
    async (c) => {
      const d = await basketDetail(ctx.db, c.req.valid("param").id);
      if (!d) return c.json({ error: "not found" }, 404);
      const { usdg } = c.req.valid("query");
      const amounts = legAmounts(usdg, d.basket.legs.map((l) => l.weight));
      const legs = await Promise.all(
        d.basket.legs.map(async (l, i) => {
          const [t] = await ctx.db.select().from(tokens).where(eq(tokens.symbol, l.token_symbol));
          const ref = { symbol: l.token_symbol, address: l.token_address, decimals: t?.decimals ?? 18, poolFee: t?.poolFee ?? null };
          try {
            const [probe, sized] = await Promise.all([ctx.quotes.buy(ref, "10"), ctx.quotes.buy(ref, amounts[i]!)]);
            const price = unitPrice(amounts[i]!, sized.tokensOut);
            const slip = slippageBps(price, unitPrice("10", probe.tokensOut));
            return { token_symbol: l.token_symbol, underlying_ticker: l.underlying_ticker, usdg: amounts[i]!, price, slippage_bps: slip, over_cap: slip > ctx.maxSlipBps, error: null };
          } catch (e) {
            return { token_symbol: l.token_symbol, underlying_ticker: l.underlying_ticker, usdg: amounts[i]!, price: null, slippage_bps: null, over_cap: true, error: String((e as Error).message) };
          }
        }),
      );
      return c.json({ usdg, max_slip_bps: ctx.maxSlipBps, legs }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/baskets/{id}/links",
      summary: "Prefilled swap links per leg, into the user's own wallet. Geofenced: never served to US users.",
      request: { params: BasketParams, query: z.object({ usdg: z.coerce.number().positive().max(1_000_000).default(100), wallet: z.string().optional() }) },
      responses: {
        200: json(z.object({ simulated: z.boolean(), links: z.array(TradeLink) }), "Links"),
        404: notFound,
        451: json(ErrorBody, "Unavailable in this region"),
      },
    }),
    async (c) => {
      if (!tradeLinksAllowed(requestCountry((n) => c.req.header(n)), { allowUnknown: ctx.mode === "local" })) {
        return c.json({ error: "Trade links are not available in your region." }, 451);
      }
      const d = await basketDetail(ctx.db, c.req.valid("param").id);
      if (!d) return c.json({ error: "not found" }, 404);
      const { usdg } = c.req.valid("query");
      const simulated = d.commit?.simulated ?? true;
      const amounts = legAmounts(usdg, d.basket.legs.map((l) => l.weight));
      const { chainSlug, usdgAddress } = ctx.links;
      const links = d.basket.legs.map((l, i) => ({
        token_symbol: l.token_symbol,
        underlying_ticker: l.underlying_ticker,
        token_address: l.token_address,
        usdg: amounts[i]!,
        url: !simulated && chainSlug && usdgAddress ? uniswapSwapUrl({ chainSlug, usdgAddress, tokenAddress: l.token_address, usdgAmount: amounts[i]! }) : null,
      }));
      return c.json({ simulated, links }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/scorecard",
      summary: "Every graded and voided basket, with hit rate, alpha vs SPY and calibration",
      request: { query: ScorecardQuery },
      responses: {
        200: json(
          z.object({
            summary: ScorecardSummary,
            rows: z.array(ScorecardRow),
            disabled_categories: z.array(z.object({ category: z.enum(CATEGORIES), reason: z.string(), since: z.string() })),
          }),
          "Scorecard",
        ),
      },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const rows = await scorecardRows(ctx.db, { from: q.from, to: q.to, category: q.sector });
      const off = await ctx.db.select().from(categoryOverrides).where(eq(categoryOverrides.disabled, true));
      return c.json({ summary: computeScorecard(rows), rows, disabled_categories: off.map((o) => ({ category: o.category, reason: o.reason, since: o.updatedAt.toISOString() })) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/scorecard.csv",
      summary: "One row per leg: everything needed to recompute every grade",
      request: { query: ScorecardQuery },
      responses: { 200: { content: { "text/csv": { schema: z.string() } }, description: "CSV" } },
    }),
    async (c) => {
      const q = c.req.valid("query");
      c.header("content-disposition", 'attachment; filename="nightshift-signals-scorecard.csv"');
      c.header("content-type", "text/csv; charset=utf-8");
      return c.body(scorecardCsv(await csvLegs(ctx.db, { from: q.from, to: q.to, category: q.sector })), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/scorecard/{date}",
      summary: "The morning report: baskets graded at 9:45 ET on one day",
      request: { params: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ param: { name: "date", in: "path" } }) }) },
      responses: { 200: json(z.object({ date: z.string(), summary: ScorecardSummary, rows: z.array(ScorecardRow) }), "Morning report") },
    }),
    async (c) => {
      const { date } = c.req.valid("param");
      const gradeAt = etToUtc(date, 9, 45).getTime();
      const rows = (await scorecardRows(ctx.db, {})).filter((r) => r.graded_at && Math.abs(new Date(r.graded_at).getTime() - gradeAt) < 6 * 3600_000);
      return c.json({ date, summary: computeScorecard(rows), rows }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/fairvalue",
      summary: "Every token's gap to off-hours fair value (the radar)",
      responses: { 200: json(z.object({ items: z.array(FairValue) }), "Fair values") },
    }),
    async (c) => c.json({ items: [...(await ctx.fairValue.all()).values()] }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/fairvalue/{symbol}",
      summary: "One token's fair value; frozen while its proxy market is closed",
      request: { params: z.object({ symbol: z.string().openapi({ param: { name: "symbol", in: "path" } }) }) },
      responses: { 200: json(FairValue, "Fair value"), 404: json(ErrorBody, "Unknown or no fair value yet") },
    }),
    async (c) => {
      const s = c.req.valid("param").symbol.toUpperCase();
      const g = [...(await ctx.fairValue.all()).values()].find((x) => x.symbol === s || x.underlying === s);
      return g ? c.json(g, 200) : c.json({ error: "no fair value" }, 404);
    },
  );

  return app;
}

export async function liveLegs(ctx: ApiContext, basket: Basket) {
  const gaps = await ctx.fairValue.gaps(basket.legs.map((l) => l.underlying_ticker));
  const mids = await ctx.prices.getMany(basket.legs.map((l) => l.token_symbol));
  return basket.legs.map((l) => {
    const mid = mids.get(l.token_symbol)?.px ?? null;
    const g = gaps.get(l.underlying_ticker);
    return {
      token_symbol: l.token_symbol,
      underlying_ticker: l.underlying_ticker,
      mid,
      fair_value: g?.fv ?? null,
      gap_bps: g?.gap_bps ?? null,
      frozen: g?.frozen ?? false,
      move_since_entry_pct: mid ? moveBps(mid, l.entry_quote_price) / 100 : null,
    };
  });
}
