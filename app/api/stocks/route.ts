import { NextResponse } from "next/server";
import { getStockBoard } from "@/lib/stocks";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await getStockBoard();
  return NextResponse.json(board, {
    headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=300", "Access-Control-Allow-Origin": "*" },
  });
}
