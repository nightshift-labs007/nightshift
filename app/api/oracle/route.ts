import { NextResponse } from "next/server";
import { getOracleSnapshot } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getOracleSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120", "Access-Control-Allow-Origin": "*" },
  });
}
