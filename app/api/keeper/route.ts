import { NextResponse, type NextRequest } from "next/server";
import { pushPrices, runGuardian } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every few minutes by an external scheduler (e.g. cron-job.org), because Vercel's free
// plan only allows daily crons. Pushes Oracle prices on-chain and runs the on-chain Guardian.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? req.nextUrl.searchParams.get("key");
  if (!secret || given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const out: Record<string, unknown> = { at: new Date().toISOString() };
  try {
    out.prices = await pushPrices();
  } catch (e) {
    out.prices = { error: String(e).slice(0, 300) };
  }
  try {
    out.guardian = await runGuardian();
  } catch (e) {
    out.guardian = { error: String(e).slice(0, 300) };
  }
  return NextResponse.json(out);
}
