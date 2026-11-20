// Server error monitoring without a third-party service: Next.js calls onRequestError for errors thrown while
// rendering pages or running route handlers. They go to the scrubbed error log (/api/ops/errors) and the server log.
// To add Sentry later, install @sentry/nextjs and call its captureRequestError here as well.
export async function onRequestError(err: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./lib/ops");
  await reportError(`server ${request.method} ${request.path.replace(/[?#].*$/, "")}`, err);
}
