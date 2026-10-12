import { NextResponse } from "next/server";
import { explorerAccount, explorerTx, ledgerAddress, readStamps } from "@/lib/algorand";
import { loadAllPairs, toSessions } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const address = ledgerAddress();
  if (!address) return NextResponse.json({ configured: false });

  try {
    const [stamps, pairs] = await Promise.all([readStamps(address), loadAllPairs()]);
    const opens = new Map<string, number>(); // "SPY|2026-10-09" -> real open
    for (const p of pairs) {
      if (p.source !== "live") continue;
      for (const s of toSessions(p.etf.bars)) opens.set(`${p.pair.token}|${s.date}`, s.open);
    }
    const entries = stamps.map((s) => ({
      txId: s.txId,
      explorer: explorerTx(s.txId),
      round: s.round,
      lockedAt: new Date(s.roundTime * 1000).toISOString(),
      session: s.session,
      hash: s.h,
      tokens: Object.entries(s.p).map(([token, predicted]) => {
        const actual = opens.get(`${token}|${s.session}`) ?? null;
        return {
          token,
          predicted,
          confidence: s.c?.[token] ?? null,
          actual,
          errBps: actual ? Math.abs(predicted / actual - 1) * 1e4 : null,
        };
      }),
    }));
    return NextResponse.json({ configured: true, address, accountUrl: explorerAccount(address), entries });
  } catch (e) {
    return NextResponse.json({ configured: true, address, accountUrl: explorerAccount(address), error: String(e), entries: [] });
  }
}
