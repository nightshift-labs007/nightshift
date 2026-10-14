"use client";

import type { OracleSnapshot } from "@/lib/oracle";
import { CountUp } from "./CountUp";
import { signed, usd } from "./useApi";

export function OracleBoard({ snap }: { snap: OracleSnapshot | null }) {
  if (!snap) return <div className="skeleton">Loading live prices<span className="blink">…</span></div>;

  const anySim = snap.quotes.some((q) => q.source === "simulated");

  return (
    <>
      <div className="small muted mono" style={{ marginBottom: 14 }}>
        {snap.market.etTime} · {snap.market.phase} · refreshed {new Date(snap.updatedAt).toLocaleTimeString()}
        {snap.fearGreed && <> · Fear &amp; Greed {snap.fearGreed.value} ({snap.fearGreed.label})</>}
      </div>
      {anySim && (
        <div className="panel red small" style={{ marginBottom: 14 }}>
          Some market feeds could not be reached from this server, so those units are running on{" "}
          <b className="amber">simulated data</b>. The pipeline and math are identical.
        </div>
      )}
      <div className="grid cols-4">
        {snap.quotes.map((q) => (
          <div key={q.token} className="panel quote">
            <div className="top">
              <span className="ticker">{q.token}</span>
              <span className={`badge ${q.marketOpen ? "open" : q.source === "live" ? "live" : "sim"}`}>
                {q.marketOpen ? "market open" : q.source}
              </span>
            </div>
            <div className="small muted">{q.name}</div>
            <div className="fv">
              <CountUp value={q.fairValue} format={(x) => usd(x)} />
            </div>
            <div className="xs muted mono">{q.marketOpen ? "Live market price" : "Nightshift fair value"}</div>

            <div className="meter" title="Confidence">
              <div style={{ width: `${q.confidence}%`, background: q.confidence >= 80 ? "var(--green)" : q.confidence >= 60 ? "var(--amber)" : "var(--red)" }} />
            </div>
            <div className="row">
              <span className="muted">Confidence</span>
              <span className="mono">{q.confidence}/100</span>
            </div>
            <div className="row">
              <span className="muted">Stale feed (last close)</span>
              <span className="mono">{usd(q.lastClose)}</span>
            </div>
            <div className="row">
              <span className="muted">Drift vs stale feed</span>
              <span className={`mono ${q.driftPct >= 0 ? "up" : "down"}`}>{signed(q.driftPct)}</span>
            </div>
            <div className="row">
              <span className="muted">{q.anchorName}</span>
              <span className={`mono ${q.anchorMovePct >= 0 ? "up" : "down"}`}>{signed(q.anchorMovePct)}</span>
            </div>
            {q.beta && (
              <div className="row" title="Overnight sensitivity to the anchor, measured from recent sessions and Blume-adjusted (0.67·β + 0.33); 1.0 when there are fewer than 10 sessions or R² is below 0.3.">
                <span className="muted">Measured beta</span>
                <span className="mono">
                  {q.beta.value.toFixed(2)}
                  {q.beta.fallback ? ` (fallback: ${q.beta.fallback})` : ` · R² ${q.beta.r2?.toFixed(2)} · ${q.beta.sessions} nights`}
                </span>
              </div>
            )}
            {!!q.flags?.length && (
              <div className="oracle-flags">
                {q.flags.map((f) => (
                  <div key={f}>Confidence capped: {f}</div>
                ))}
              </div>
            )}

            {q.agents.length > 0 && (
              <div className="agents">
                {q.agents.map((a) => (
                  <div key={a.id} className="agent">
                    <span>{a.name}</span>
                    <span className="w">
                      {usd(a.estimate)} · w{(a.weight * 100).toFixed(0)}
                    </span>
                    <span className="sig">{a.signal}</span>
                  </div>
                ))}
                {(q.learned?.sessions ?? 0) >= 5 && <div className="learned">Weights re-fit from the last {q.learned?.sessions} opens</div>}
              </div>
            )}
            {q.marketOpen && (
              <div className="agents small muted">Wall Street is open, so the real market price is used directly.</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
