import { loadEnv } from "@nightshift-signals/worker/env";
import { buildRuntime } from "@nightshift-signals/worker/runtime";
import { contextFrom, startApi } from "./server";

// Production entry: REST + WebSocket only; the pipeline runs in apps/worker. They share Postgres and Redis.
const env = loadEnv();
if (!env.REDIS_URL) {
  console.error("[api] REDIS_URL is not set. Run `pnpm db:up`, or `pnpm dev:local` for the single-process simulated stack.");
  process.exit(1);
}
const rt = await buildRuntime(env);
const { server, gateway } = startApi(contextFrom(env, rt), env.API_PORT);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    gateway.close();
    server.close();
    await rt.deps.bus.close();
    await rt.handle.close();
    process.exit(0);
  });
}
