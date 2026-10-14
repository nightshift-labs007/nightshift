import type { NextRequest } from "next/server";
import { v1 } from "@/lib/apiv1";
import { getShiftReports } from "@/lib/backtest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return v1(req, async () => ({
    method: "At 09:30 ET the open is predicted from the previous close and the anchor's overnight move, with a beta measured from earlier sessions only; errors in basis points vs the actual open, alongside a frozen (stale) feed.",
    reports: await getShiftReports(),
  }), 600);
}
