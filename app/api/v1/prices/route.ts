import type { NextRequest } from "next/server";
import { price, v1 } from "@/lib/apiv1";
import { getOracleSnapshot } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return v1(req, async () => {
    const snap = await getOracleSnapshot();
    return { updatedAt: snap.updatedAt, market: snap.market, prices: snap.quotes.map((q) => price(q, snap.updatedAt)) };
  });
}
