import { NextResponse, type NextRequest } from "next/server";
import { getStockDetail, STOCK_RANGES, type StockRange } from "@/lib/stocks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const range = (req.nextUrl.searchParams.get("range") ?? "1D").toUpperCase() as StockRange;
  if (!STOCK_RANGES.includes(range)) return NextResponse.json({ error: "range must be 1D, 5D, 1M or 3M" }, { status: 400 });
  const detail = await getStockDetail(ticker.toUpperCase(), range);
  if (!detail) return NextResponse.json({ error: "unknown stock" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=300" } });
}
