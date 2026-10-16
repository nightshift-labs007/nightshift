import { NextResponse, type NextRequest } from "next/server";
import { isAddress, recoverMessageAddress } from "viem";
import { readJoins, recordJoin, explorerTx } from "@/lib/algorand";
import { joinMessage } from "@/lib/join";
import { invalidateLeaderboard } from "@/lib/leaderboard";
import { allow, take } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SIG_MAX_AGE_MS = 5 * 60 * 1000;

// Adds a wallet to the public leaderboard. The visitor signs a free message (no transaction) proving the address is
// theirs and that they agree to be listed; the join is then recorded as a note on Algorand, which is the list.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; signature?: `0x${string}`; issuedAt?: string };
  const { address, signature, issuedAt } = body;
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  const age = Date.now() - Date.parse(issuedAt ?? "");
  if (!signature || !(age >= -60_000 && age < SIG_MAX_AGE_MS)) return NextResponse.json({ error: "Please sign the message in your wallet." }, { status: 401 });
  const signer = await recoverMessageAddress({ message: joinMessage(address, issuedAt!), signature }).catch(() => null);
  if (!signer || signer.toLowerCase() !== address.toLowerCase()) return NextResponse.json({ error: "Signature doesn't match this address." }, { status: 401 });

  const a = address.toLowerCase();
  const joins = await readJoins().catch(() => null);
  const existing = joins?.find((j) => j.address === a);
  if (existing) return NextResponse.json({ joined: true, already: true, tx: explorerTx(existing.txId) });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await take(`join:addr:${a}`, 600))) return NextResponse.json({ error: "This address is already being added. Check back in a minute." }, { status: 429 });
  if (!(await allow(`join:ip:${ip}`, 10, 86400)).ok) return NextResponse.json({ error: "Too many joins from this network today." }, { status: 429 });

  try {
    const txId = await recordJoin(a);
    invalidateLeaderboard();
    return NextResponse.json({ joined: true, tx: explorerTx(txId) });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't record the join right now: ${String(e).slice(0, 120)}` }, { status: 503 });
  }
}
