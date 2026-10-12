"use client";

import { useState } from "react";
import type { ShiftReport as Report } from "@/lib/backtest";
import { usd, useApi } from "./useApi";

export function ShiftReport() {
  const { data } = useApi<{ reports: Report[] }>("/api/shift-report");
  const [tab, setTab] = useState(0);

  if (!data) return <div className="skeleton">Compiling shift report<span className="blink">_</span></div>;
  const r = data.reports[tab];
  if (!r) return null;
  const max = Math.max(1, ...r.rows.flatMap((x) => [x.nightshiftErrBps, x.staleErrBps]));
  const improvement = r.avgStaleBps > 0 ? (1 - r.avgNightshiftBps / r.avgStaleBps) * 100 : 0;

  return (
    <>
      <div className="tabs">
        {data.reports.map((x, i) => (
          <button key={x.token} className={`tab ${i === tab ? "on" : ""}`} onClick={() => setTab(i)}>
            {x.token}
          </button>
        ))}
        <span className={`badge ${r.source === "live" ? "live" : "sim"}`} style={{ alignSelf: "center", marginLeft: 6 }}>
          {r.source}
        </span>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="k">Nightshift avg error</div>
          <div className="v accent">{r.avgNightshiftBps.toFixed(1)} bps</div>
        </div>
        <div className="stat">
          <div className="k">Stale feed avg error</div>
          <div className="v down">{r.avgStaleBps.toFixed(1)} bps</div>
        </div>
        <div className="stat">
          <div className="k">Error reduction</div>
          <div className={`v ${improvement >= 0 ? "up" : "down"}`}>{improvement.toFixed(0)}%</div>
        </div>
        <div className="stat">
          <div className="k">Mornings won</div>
          <div className="v">
            {r.wins}/{r.rows.length}
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <div className="xs mono muted" style={{ marginBottom: 10 }}>
            Opening-price error · <span className="legend-ns">Nightshift</span> · <span className="legend-stale">Frozen feed</span>
          </div>
          <div className="bars">
            {r.rows.map((x) => (
              <div key={x.date} className="barrow">
                <span className="muted">{x.date}</span>
                <div className="barpair">
                  <div className="bar ns" style={{ width: `${(x.nightshiftErrBps / max) * 100}%` }} title={`${x.nightshiftErrBps.toFixed(1)} bps`} />
                  <div className="bar stale" style={{ width: `${(x.staleErrBps / max) * 100}%` }} title={`${x.staleErrBps.toFixed(1)} bps`} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="table-wrap panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Open</th>
                <th className="num">Predicted</th>
                <th className="num">Actual</th>
                <th className="num">Err bps</th>
                <th className="num">Stale bps</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.date}>
                  <td className="mono">{x.date}</td>
                  <td className="num">{usd(x.predictedOpen)}</td>
                  <td className="num">{usd(x.actualOpen)}</td>
                  <td className={`num ${x.nightshiftErrBps <= x.staleErrBps ? "up" : "down"}`}>{x.nightshiftErrBps.toFixed(1)}</td>
                  <td className="num muted">{x.staleErrBps.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="xs muted" style={{ marginTop: 10 }}>
        Replay of the anchor signal using only data available before each 09:30 ET open (1 bps = 0.01%). The stale feed is what a
        traditional oracle reports overnight: the previous close.
      </p>
    </>
  );
}
