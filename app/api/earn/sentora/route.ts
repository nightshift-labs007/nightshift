import { NextResponse } from "next/server";
import { getSentoraEarn } from "@/lib/earn/sentora";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getSentoraEarn();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=600", "Access-Control-Allow-Origin": "*" },
  });
}
