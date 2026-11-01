import { loadEnv } from "@nightshift-signals/worker/env";
import { buildRuntime, startWorker } from "@nightshift-signals/worker/runtime";
import { contextFrom, startApi } from "./server";

// `pnpm dev:local`: API, WebSocket and the whole pipeline in one process, on embedded Postgres (PGlite),
// an in-memory bus, a simulated market and a simulated ledger. No Docker, Redis or keys needed.
// Nothing here is real: commits are chain 0 and the UI labels them simulated.
const env = loadEnv({ ...process.env, NIGHTSHIFT_SIGNALS_MODE: "local", REDIS_URL: "" });
const rt = await buildRuntime(env);
const stopWorker = startWorker(rt);
const { server, gateway } = startApi(contextFrom(env, rt), env.API_PORT);
console.log(`[local] simulated stack up. Database: ${env.DATABASE_URL}. A scripted headline arrives every 2 minutes.`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    gateway.close();
    server.close();
    await stopWorker();
    process.exit(0);
  });
}
