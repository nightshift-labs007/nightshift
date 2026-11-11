import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness only (the process is up and serving). /api/health is the operational check and can return 503. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
