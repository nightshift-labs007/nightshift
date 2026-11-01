import { loadEnv } from "./env";
import { buildRuntime, startWorker } from "./runtime";

// Production entry: one process runs every pipeline queue and schedule. Split queues into
// separate processes only when a queue's lag exceeds its budget.
const env = loadEnv();
if (!env.REDIS_URL) {
  console.error("[worker] REDIS_URL is not set. Run `pnpm db:up`, or use `pnpm dev:local` for the single-process simulated stack.");
  process.exit(1);
}
const rt = await buildRuntime(env);
const stop = startWorker(rt);
console.log(`[worker] up in ${env.NIGHTSHIFT_SIGNALS_MODE} mode`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`[worker] ${signal}, shutting down`);
    await stop();
    process.exit(0);
  });
}
