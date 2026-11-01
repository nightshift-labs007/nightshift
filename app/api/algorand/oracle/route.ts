import { NextResponse } from "next/server";
import { ALGO_ORACLE, algoAppUrl, readAlgorandFeeds } from "@/lib/algorand-oracle";

export const dynamic = "force-dynamic";

/** The Oracle's prices as stored on Algorand TestNet, read straight from the app's global state. */
export async function GET() {
  if (!ALGO_ORACLE) return NextResponse.json({ deployed: false, network: "testnet" });
  try {
    const feeds = await readAlgorandFeeds();
    return NextResponse.json(
      { deployed: true, network: "testnet", appId: ALGO_ORACLE.appId, appUrl: algoAppUrl(ALGO_ORACLE.appId), maxMoveBps: ALGO_ORACLE.maxMoveBps, feeds },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (e) {
    return NextResponse.json({ deployed: true, network: "testnet", appId: ALGO_ORACLE.appId, appUrl: algoAppUrl(ALGO_ORACLE.appId), error: String(e).slice(0, 200), feeds: [] });
  }
}
