import { NextResponse } from "next/server";
import { readPredictions } from "@/lib/chain/predictions";
import { realStakesOn } from "@/lib/gates";

export const dynamic = "force-dynamic";

/** "Call the Open": the latest rounds (newest first), their pools and the contract's limits. */
export async function GET() {
  // real stakes are off unless REAL_STAKES=on: say so, and don't even read the contract
  if (!realStakesOn(process.env)) return NextResponse.json({ enabled: false, rounds: [], reason: "off", updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  try {
    const state = await readPredictions();
    return NextResponse.json(state, { headers: { "Cache-Control": "s-maxage=15, stale-while-revalidate=30" } });
  } catch (e) {
    return NextResponse.json({ enabled: false, rounds: [], error: String(e).slice(0, 200), updatedAt: new Date().toISOString() }, { status: 503 });
  }
}
