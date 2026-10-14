import { NextResponse, type NextRequest } from "next/server";
import { v1 } from "@/lib/apiv1";
import { getFairSeries, RANGES, type Range } from "@/lib/series";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") ?? "SPY").toUpperCase();
  const range = (req.nextUrl.searchParams.get("range") ?? "4H").toUpperCase() as Range;
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (!(range in RANGES)) return NextResponse.json({ error: "range must be 1H, 4H, 12H or 24H" }, { status: 400, headers: cors });
  const series = await getFairSeries(token, range);
  if (!series) return NextResponse.json({ error: "unknown token" }, { status: 404, headers: cors });
  return v1(req, async () => series, 120);
}
