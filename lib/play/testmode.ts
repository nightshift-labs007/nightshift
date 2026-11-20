// When test-only helpers (the x-play-now clock, the dev email outbox, the Beat the AI call setter) may run.
// - Local development: always (NODE_ENV !== "production").
// - A Vercel PREVIEW deployment, or a deployment explicitly marked NIGHTSHIFT_ENV=staging (e.g. a Railway staging
//   service): only with PLAY_TEST_MODE=1, for the end-to-end smoke test.
// - Production: never, whatever the flags say. A Vercel production deployment, or anything marked
//   NIGHTSHIFT_ENV=production, is never test mode.

export function testMode(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.PLAY_TEST_MODE !== "1") return false;
  if (process.env.VERCEL_ENV === "production" || process.env.NIGHTSHIFT_ENV === "production") return false;
  return process.env.VERCEL_ENV === "preview" || process.env.NIGHTSHIFT_ENV === "staging";
}
