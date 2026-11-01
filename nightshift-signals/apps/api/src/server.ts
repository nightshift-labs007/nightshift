import { MemoryRateLimiter, RedisRateLimiter } from "@nightshift-signals/adapters";
import { serve } from "@hono/node-server";
import type { Env as WorkerEnv } from "@nightshift-signals/worker/env";
import type { Runtime } from "@nightshift-signals/worker/runtime";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { hostname } from "node:os";
import { createApp } from "./app";
import type { ApiContext } from "./context";
import { Gateway } from "./ws";

export function contextFrom(env: WorkerEnv, rt: Runtime): ApiContext {
  if (env.NIGHTSHIFT_SIGNALS_MODE === "live" && !env.JWT_SECRET) throw new Error("JWT_SECRET is required in live mode");
  return {
    db: rt.deps.db,
    bus: rt.deps.bus,
    prices: rt.deps.prices,
    fairValue: rt.fairValue,
    quotes: rt.deps.quotes,
    model: rt.deps.model,
    rateLimiter: env.REDIS_URL ? new RedisRateLimiter(env.REDIS_URL) : new MemoryRateLimiter(),
    mode: env.NIGHTSHIFT_SIGNALS_MODE,
    jwtSecret: new TextEncoder().encode(env.JWT_SECRET ?? randomBytes(32).toString("hex")),
    maxSlipBps: rt.deps.config.maxSlipBps,
    vapidPublicKey: rt.vapidPublicKey,
    telegram:
      env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET
        ? { botToken: env.TELEGRAM_BOT_TOKEN, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET, appUrl: env.APP_URL }
        : null,
    links: { chainSlug: env.UNISWAP_CHAIN_SLUG ?? null, usdgAddress: env.USDG_ADDRESS ?? null },
    now: () => new Date(),
  };
}

export function startApi(ctx: ApiContext, port: number): { server: Server; gateway: Gateway } {
  const app = createApp(ctx);
  const gateway = new Gateway(ctx, `${hostname()}-${process.pid}`);
  gateway.subscribeBus();
  const server = serve({ fetch: app.fetch, port }, (info) => console.log(`[api] http://localhost:${info.port}  (docs: /v1/openapi.json, ws: /ws)`)) as Server;
  gateway.attach(server);
  return { server, gateway };
}
