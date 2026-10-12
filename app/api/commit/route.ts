import { NextResponse, type NextRequest } from "next/server";
import { getOracleSnapshot } from "@/lib/oracle";
import { hashPrediction, ledgerAddress, stampPrediction, explorerTx, type Prediction } from "@/lib/algorand";
import { nextSessionDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Called by Vercel Cron (see vercel.json) before the US open. Locks the Oracle's
// predicted opening prices onto Algorand TestNet so nobody can edit them afterwards.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const snap = await getOracleSnapshot();
  const pred: Prediction = {
    session: nextSessionDate(),
    at: snap.updatedAt,
    p: Object.fromEntries(snap.quotes.map((q) => [q.token, Number(q.fairValue.toFixed(4))])),
    c: Object.fromEntries(snap.quotes.map((q) => [q.token, q.confidence])),
  };

  if (!ledgerAddress()) {
    return NextResponse.json({ committed: false, reason: "ALGORAND_MNEMONIC not set", prediction: pred, hash: hashPrediction(pred) });
  }

  try {
    const { txId, hash } = await stampPrediction(pred);
    return NextResponse.json({ committed: true, txId, explorer: explorerTx(txId), hash, prediction: pred });
  } catch (e) {
    return NextResponse.json({ committed: false, error: String(e), prediction: pred }, { status: 500 });
  }
}
