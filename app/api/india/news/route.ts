import { NextResponse } from "next/server";
import { getRadar } from "@/lib/india/news";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getRadar(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
}
