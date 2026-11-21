// Server error monitoring without a third-party service: Next.js calls onRequestError for errors thrown while
// rendering pages or running route handlers. They go to the scrubbed error log (/api/ops/errors) and the server log.
// To add Sentry later, install @sentry/nextjs and call its captureRequestError here as well.
export async function onRequestError(err: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./lib/ops");
  await reportError(`server ${request.method} ${request.path.replace(/[?#].*$/, "")}`, err);
}

// Built-in scheduler for always-on hosts (Railway, a VM): with IN_APP_SCHEDULER=1 the server calls its own job
// endpoints, exactly as an external scheduler would (Bearer CRON_SECRET, so the runs count as scheduled in
// /api/ops/health). Points games every 5 minutes, on-chain keeper every 10. Don't turn it on for Vercel (serverless).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.IN_APP_SCHEDULER !== "1") return;
  const secret = (process.env.CRON_SECRET ?? "").replace(/^["']|["']$/g, "");
  if (!secret) return console.warn("IN_APP_SCHEDULER=1 but CRON_SECRET is not set: scheduler off");
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const hit = (path: string) =>
    fetch(base + path, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(110_000) })
      .then((r) => { if (!r.ok) console.warn(`scheduler ${path}: ${r.status}`); })
      .catch((e) => console.warn(`scheduler ${path}: ${e?.message ?? e}`));
  let tick = 0;
  const run = () => { hit("/api/jobs/play"); if (tick++ % 2 === 0) hit("/api/keeper"); };
  setTimeout(run, 30_000); // let the server finish starting
  setInterval(run, 5 * 60_000).unref();
  console.log("in-app scheduler on: /api/jobs/play every 5 min, /api/keeper every 10 min");
}
