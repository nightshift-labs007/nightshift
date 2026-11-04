import { NextResponse } from "next/server";
import { getShiftReports } from "@/lib/backtest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ?rows=N (up to 25): how many recent opens per token; 10 by default
  const rows = Math.min(25, Math.max(1, Number(new URL(req.url).searchParams.get("rows")) || 10));
  const reports = await getShiftReports(rows);
  return NextResponse.json({ updatedAt: new Date().toISOString(), reports }, {
    headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=1200" },
  });
}
