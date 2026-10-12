import { NextResponse } from "next/server";
import { getShiftReports } from "@/lib/backtest";

export const dynamic = "force-dynamic";

export async function GET() {
  const reports = await getShiftReports();
  return NextResponse.json({ updatedAt: new Date().toISOString(), reports }, {
    headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=1200" },
  });
}
