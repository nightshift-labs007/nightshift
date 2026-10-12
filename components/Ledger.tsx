"use client";

import { usd, useApi } from "./useApi";

type LedgerResponse = {
  configured: boolean;
  address?: string;
  accountUrl?: string;
  error?: string;
  entries?: {
    txId: string;
    explorer: string;
    round: number;
    lockedAt: string;
    session: string;
    hash: string;
    tokens: { token: string; predicted: number; confidence: number | null; actual: number | null; errBps: number | null }[];
  }[];
};

export function Ledger() {
  const { data } = useApi<LedgerResponse>("/api/ledger");

  if (!data) return <div className="skeleton">Reading Algorand<span className="blink">_</span></div>;

  if (!data.configured) {
    return (
      <div className="panel">
        <div className="unit">Ledger not yet enabled</div>
        <p className="small" style={{ marginBottom: 0 }}>
          No Algorand TestNet account configured yet. Set <span className="mono accent">ALGORAND_MNEMONIC</span> and{" "}
          <span className="mono accent">CRON_SECRET</span> in Vercel. A daily cron then locks the Oracle&apos;s predicted opens on-chain
          before the bell, and they appear here with their real outcome.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="small muted mono" style={{ marginTop: 0 }}>
        Stamping account:{" "}
        <a href={data.accountUrl} target="_blank" rel="noreferrer">
          {data.address?.slice(0, 10)}…{data.address?.slice(-6)}
        </a>{" "}
        · Algorand TestNet
      </p>
      {data.error && <div className="panel red small">Indexer error: {data.error}</div>}
      {data.entries?.length === 0 && (
        <div className="panel small">No predictions stamped yet. The first one lands at the next cron run (weekdays, 12:00 UTC).</div>
      )}
      <div className="grid">
        {data.entries?.map((e) => (
          <div key={e.txId} className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span className="mono">
                <b>Open of {e.session}</b> <span className="muted">· locked {new Date(e.lockedAt).toLocaleString()} · round {e.round}</span>
              </span>
              <a className="mono small" href={e.explorer} target="_blank" rel="noreferrer">
                {e.txId.slice(0, 12)}… ↗
              </a>
            </div>
            <div className="table-wrap">
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th className="num">Predicted</th>
                    <th className="num">Conf</th>
                    <th className="num">Actual open</th>
                    <th className="num">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {e.tokens.map((t) => (
                    <tr key={t.token}>
                      <td className="mono">{t.token}</td>
                      <td className="num">{usd(t.predicted)}</td>
                      <td className="num">{t.confidence ?? "–"}</td>
                      <td className="num">{t.actual ? usd(t.actual) : <span className="muted">pending</span>}</td>
                      <td className="num">{t.errBps != null ? `${t.errBps.toFixed(1)} bps` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="xs mono muted" style={{ marginTop: 6, wordBreak: "break-all" }}>
              sha256 {e.hash}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
