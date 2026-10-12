import { NextResponse, type NextRequest } from "next/server";
import * as snarkjs from "snarkjs";
import vkey from "@/public/zk/verification_key.json";
import { PAIRS } from "@/lib/config";
import { getOracleSnapshot } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PRICE_TOLERANCE = 0.005; // Oracle refreshes every minute; allow 0.5% drift between prove and verify

// Independent verifier: the browser generated the proof, the protocol checks it here.
// publicSignals = [commitment, priceCents, lltvBps]
export async function POST(req: NextRequest) {
  const { token, proof, publicSignals } = await req.json();
  if (!proof || !Array.isArray(publicSignals) || publicSignals.length !== 3) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const t0 = Date.now();
  let valid = false;
  try {
    valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } catch {
    valid = false;
  }
  const verifyMs = Date.now() - t0;

  // A valid proof only means "solvent at the price the prover claimed".
  // The protocol must also check that price and LLTV are the real ones.
  const [commitment, priceCents, lltvBps] = publicSignals.map(String);
  const pair = PAIRS.find((p) => p.token === token);
  const snap = await getOracleSnapshot();
  const quote = snap.quotes.find((q) => q.token === token);
  const oracleCents = quote ? Math.round(quote.fairValue * 100) : null;
  const priceMatchesOracle = oracleCents != null && Math.abs(Number(priceCents) / oracleCents - 1) <= PRICE_TOLERANCE;
  const lltvMatchesMarket = pair != null && Number(lltvBps) === Math.round(pair.lltv * 10000);

  return NextResponse.json({
    valid,
    accepted: valid && priceMatchesOracle && lltvMatchesMarket,
    verifyMs,
    statement: { commitment, priceCents: Number(priceCents), lltvBps: Number(lltvBps) },
    checks: { proof: valid, priceMatchesOracle, lltvMatchesMarket, oracleCents },
  });
}
