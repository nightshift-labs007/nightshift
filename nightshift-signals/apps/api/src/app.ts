import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { ApiContext, Env } from "./context";
import { meRoutes } from "./routes/me";
import { publicRoutes } from "./routes/public";
import { socialRoutes } from "./routes/social";
import { telegramRoutes } from "./routes/telegram";

export const RATE_LIMIT_PER_MIN = 60;

export function createApp(ctx: ApiContext) {
  const app = new OpenAPIHono<Env>();
  app.use("*", cors({ origin: (o) => o, allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "DELETE"] }));

  app.get("/health", (c) => c.json({ ok: true, mode: ctx.mode }));

  app.use("/v1/*", async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!(await ctx.rateLimiter.hit(ip, RATE_LIMIT_PER_MIN))) return c.json({ error: "rate limited" }, 429);
    await next();
  });

  // Social first: its literal paths (/scorecard/crowd) must win over /scorecard/{date}.
  app.route("/v1", socialRoutes(ctx));
  app.route("/v1", publicRoutes(ctx));
  app.route("/v1", meRoutes(ctx));
  app.route("/v1", telegramRoutes(ctx));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", { type: "http", scheme: "bearer", bearerFormat: "JWT" });
  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Nightshift Signals API", version: "1.0.0", description: "Events, baskets and the graded scorecard. Information, not advice." },
  });
  return app;
}
