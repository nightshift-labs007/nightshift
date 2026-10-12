import { NextResponse } from "next/server";
import { getOracleSnapshot } from "@/lib/oracle";

export const dynamic = "force-dynamic";

// Single-asset feed, e.g. GET /api/oracle/SPY
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snap = await getOracleSnapshot();
  const quote = snap.quotes.find((q) => q.token === token.toUpperCase());
  if (!quote) {
    return NextResponse.json({ error: "unknown token", tokens: snap.quotes.map((q) => q.token) }, { status: 404 });
  }
  return NextResponse.json(
    { updatedAt: snap.updatedAt, market: snap.market, quote },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120", "Access-Control-Allow-Origin": "*" } },
  );
}
