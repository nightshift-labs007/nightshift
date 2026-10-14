import type { NextRequest } from "next/server";
import { RATE, v1 } from "@/lib/apiv1";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return v1(req, async () => ({
    version: "v1",
    docs: "https://nightshift.buzz/docs#api",
    rateLimit: `${RATE.max} uncached requests per ${RATE.windowSec}s per IP; responses cached 60 s`,
    endpoints: {
      "GET /api/v1/prices": "all assets: fair value, confidence, beta, signals, on-chain feed addresses",
      "GET /api/v1/prices/{token}": "one asset (SPY, QQQ, GLD, IBIT)",
      "GET /api/v1/history?token=SPY&range=12H": "fair-value history (1H, 4H, 12H, 24H)",
      "GET /api/v1/track-record": "predicted vs actual opens, last 10 sessions per asset",
    },
  }), 3600);
}
