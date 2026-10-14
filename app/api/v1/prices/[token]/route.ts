import { NextResponse, type NextRequest } from "next/server";
import { price, v1 } from "@/lib/apiv1";
import { getOracleSnapshot } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snap = await getOracleSnapshot();
  const q = snap.quotes.find((x) => x.token === token.toUpperCase());
  if (!q) return NextResponse.json({ error: "unknown token", tokens: snap.quotes.map((x) => x.token) }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  return v1(req, async () => ({ market: snap.market, price: price(q, snap.updatedAt) }));
}
