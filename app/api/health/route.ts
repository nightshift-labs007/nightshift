import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Public operational health (no secrets): role-wallet gas, on-chain price freshness, last Guardian run, configuration. */
export async function GET() {
  const h = await getHealth();
  return NextResponse.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "s-maxage=30" } });
}
