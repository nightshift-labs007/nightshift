import { overnightBeta } from "./beta";
import { loadAllPairs, priceAt, toSessions, type Source } from "./data";

export type ShiftRow = {
  date: string;
  prevClose: number;
  predictedOpen: number;
  actualOpen: number;
  nightshiftErrBps: number;
  staleErrBps: number;
};

export type ShiftReport = {
  token: string;
  source: Source;
  rows: ShiftRow[];
  avgNightshiftBps: number;
  avgStaleBps: number;
  wins: number;
};

const bps = (a: number, b: number) => Math.abs(a / b - 1) * 1e4;

/**
 * Replays the Anchor Unit over recent sessions: at 09:30 ET it predicts the open from the
 * previous close plus the anchor's overnight move (using only data available before the open),
 * then compares against the real open and against a "stale feed" that just repeats the close.
 */
export async function getShiftReports(maxRows = 10): Promise<ShiftReport[]> {
  const pairs = await loadAllPairs();
  const nowS = Date.now() / 1000;

  return pairs.map(({ pair, etf, anchor, source }) => {
    const sessions = toSessions(etf.bars).filter((s) => s.openT <= nowS);
    const rows: ShiftRow[] = [];
    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1];
      const s = sessions[i];
      const aClose = priceAt(anchor.bars, prev.closeT);
      const aOpen = priceAt(anchor.bars, s.openT);
      if (!aClose || !aOpen) continue;
      // the beta measured from earlier sessions only (no look-ahead), as the Oracle would have had that morning
      const beta = overnightBeta(sessions.slice(0, i), anchor.bars).value;
      const predictedOpen = prev.close * (1 + beta * (aOpen / aClose - 1));
      rows.push({
        date: s.date,
        prevClose: prev.close,
        predictedOpen,
        actualOpen: s.open,
        nightshiftErrBps: bps(predictedOpen, s.open),
        staleErrBps: bps(prev.close, s.open),
      });
    }
    const recent = rows.slice(-maxRows).reverse();
    const avg = (f: (r: ShiftRow) => number) => (recent.length ? recent.reduce((a, r) => a + f(r), 0) / recent.length : 0);
    return {
      token: pair.token,
      source,
      rows: recent,
      avgNightshiftBps: avg((r) => r.nightshiftErrBps),
      avgStaleBps: avg((r) => r.staleErrBps),
      wins: recent.filter((r) => r.nightshiftErrBps < r.staleErrBps).length,
    };
  });
}
