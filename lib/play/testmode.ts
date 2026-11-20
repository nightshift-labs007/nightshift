// When test-only helpers (the x-play-now clock, the dev email outbox, the Beat the AI call setter) may run.
// - Local development: always (NODE_ENV !== "production").
// - A Vercel PREVIEW deployment: only with PLAY_TEST_MODE=1, for the end-to-end smoke test.
// - Production: never, whatever the flags say.

export function testMode(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.VERCEL_ENV === "preview" && process.env.PLAY_TEST_MODE === "1";
}
