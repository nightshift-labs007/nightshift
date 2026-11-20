import "server-only";
import { loadAllPairs, toSessions } from "@/lib/data";
import { ledgerReadAddress, readStamps } from "@/lib/ledger";
import type { RecordedCall } from "@/lib/x-text";

/**
 * Nightshift's pre-open calls as recorded on Base (the ledger index), each graded against the real open and paired
 * with the close before it. Empty when the record can't be read (no index on this server). Never uses the replay.
 */
export async function recordedCalls(limit = 60): Promise<RecordedCall[]> {
  const address = ledgerReadAddress();
  if (!address) return [];
  const [stamps, pairs] = await Promise.all([readStamps(address, limit), loadAllPairs()]);
  const opens = new Map<string, { open: number; prevClose: number }>(); // "SPY|2026-10-09" → real open + the close before it
  for (const p of pairs) {
    if (p.source !== "live") continue;
    const sessions = toSessions(p.etf.bars);
    for (let i = 1; i < sessions.length; i++) opens.set(`${p.pair.token}|${sessions[i].date}`, { open: sessions[i].open, prevClose: sessions[i - 1].close });
  }
  return stamps.flatMap((s) =>
    Object.entries(s.p).map(([token, predicted]) => {
      const o = opens.get(`${token}|${s.session}`);
      return { token, session: s.session, predicted, actual: o?.open ?? null, prevClose: o?.prevClose ?? null, txId: s.txId };
    }),
  );
}
