"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ShiftReport } from "@/lib/backtest";
import type { OracleSnapshot } from "@/lib/oracle";
import type { PredictState } from "@/lib/predictions-shared";
import type { FairSeries, Range } from "@/lib/series";
import { InfoTip } from "./InfoTip";
import { PageShell } from "./Site";
import { SignedInGate } from "./SignedIn";
import { signed, usd, useApi } from "./useApi";

type LedgerEntry = { txId: string; explorer: string; lockedAt: string; session: string; tokens: { token: string; predicted: number; actual: number | null; errBps: number | null }[] };
type Ledger = { configured: boolean; entries?: LedgerEntry[] };

const RANGES: Range[] = ["1H", "4H", "12H", "24H"];
const ET = "America/New_York";
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
const confColor = (c: number) => (c >= 80 ? "var(--mint)" : c >= 60 ? "var(--amber)" : "var(--red)");

/**
 * One ETF: what it's worth right now (live price, or Nightshift's fair value while Wall Street is closed), the path of
 * that value on a chart with Nightshift's next call marked, how the price is built, and every past call graded against
 * the real open, linked to its record on Base where there is one.
 */
export function EtfPage({ token, name, anchorName }: { token: string; name: string; anchorName: string }) {
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);
  const { data: shift } = useApi<{ reports: ShiftReport[] }>("/api/shift-report?rows=25", 600_000);
  const { data: ledger } = useApi<Ledger>("/api/ledger", 600_000);
  const { data: predict } = useApi<PredictState>("/api/predict", 60_000);
  const q = snap?.quotes.find((x) => x.token === token);
  const report = shift?.reports.find((r) => r.token === token);
  const round = predict?.rounds.filter((r) => r.token === token).sort((a, b) => b.marketOpen - a.marketOpen)[0];
  const openRound = round && round.status === "Open" && Date.now() / 1000 < round.lockTime ? round : undefined;
  const recorded = new Map((ledger?.entries ?? []).map((e) => [e.session, e]));

  return (
    <PageShell>
      <SignedInGate>
      <section className="block etf-top">
        <div className="wrap">
          <Link className="etf-back" href="/app">← All prices</Link>
          <div className="etf-head">
            <div>
              <p className="mono xs muted">{snap ? `${snap.market.etTime} · ${snap.market.open ? "WALL STREET OPEN" : "WALL STREET CLOSED"}` : "Loading…"}</p>
              <h1>
                <span className="mono">{token}</span> <span className="etf-name">{name}</span>
              </h1>
              {q ? (
                <div className="etf-price">
                  <b>{usd(q.fairValue)}</b>
                  <span className={q.driftPct >= 0 ? "up" : "down"}>{signed(q.driftPct)}</span>
                  <span className="muted small">
                    {q.marketOpen ? "live price vs last close" : <>Nightshift fair value <InfoTip k="fairValue" label="fair value" /> vs last close {usd(q.lastClose)}</>}
                  </span>
                </div>
              ) : (
                <div className="skeleton">Loading the price…</div>
              )}
            </div>
            {q && !q.marketOpen && (
              <div className="etf-conf">
                <span className="xs muted">Confidence <InfoTip k="confidence" label="confidence" /></span>
                <b style={{ color: confColor(q.confidence) }}>{q.confidence}/100</b>
                <div className="meter"><div style={{ width: `${q.confidence}%`, background: confColor(q.confidence) }} /></div>
              </div>
            )}
          </div>
          {!!q?.flags?.length && (
            <div className="oracle-flags">
              {q.flags.map((f) => <div key={f}>Confidence lowered: {f}</div>)}
            </div>
          )}
        </div>
      </section>

      <section className="block etf-chart-block">
        <div className="wrap">
          <EtfChart token={token} lastClose={q?.lastClose} call={openRound?.strike ?? null} callLabel={openRound ? `Our call for the ${day(openRound.session)} open` : null} marketOpen={!!q?.marketOpen} />
          {openRound && (
            <div className="panel etf-predict">
              <div>
                <p className="xs muted">PREDICTION ROUND · {day(openRound.session)} open</p>
                <p>
                  Nightshift&apos;s call: <b className="mono">{usd(openRound.strike)}</b>. Will {token} open higher or lower? Pools:{" "}
                  <span className="mono">{openRound.stakeHigher.toFixed(0)} Higher · {openRound.stakeLower.toFixed(0)} Lower {predict?.stakeSymbol}</span>
                </p>
              </div>
              <Link className="btn primary small" href="/app#predict">Make a prediction</Link>
            </div>
          )}
        </div>
      </section>

      {q && !q.marketOpen && q.agents.length > 0 && (
        <section className="block">
          <div className="wrap">
            <h3 className="sub-title">How this price is built</h3>
            <p className="muted small">
              While Wall Street is closed, {token} is priced from markets that keep trading, led by {anchorName}. Each signal gives an estimate; they are
              blended by weight, and the weights are re-fit from recent opens.
            </p>
            <div className="etf-agents">
              {q.agents.map((a) => (
                <div key={a.id} className="panel etf-agent">
                  <span className="xs muted">{a.name}</span>
                  <b className="mono">{usd(a.estimate)}</b>
                  <span className="xs">{a.signal}</span>
                  <span className="xs muted">weight {(a.weight * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="block alt">
        <div className="wrap">
          <h3 className="sub-title">Every past call, graded</h3>
          {report ? (
            <>
              <div className="etf-score">
                <div><span className="xs muted">Our average miss</span><b className="mono mint">{(report.avgNightshiftBps / 100).toFixed(2)}%</b></div>
                <div><span className="xs muted">A frozen price&apos;s average miss</span><b className="mono">{(report.avgStaleBps / 100).toFixed(2)}%</b></div>
                <div><span className="xs muted">Closer than the frozen price</span><b className="mono">{report.wins} of {report.rows.length}</b></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Open</th>
                      <th className="num">Last close</th>
                      <th className="num">Our call</th>
                      <th className="num">Opened at</th>
                      <th className="num">Our miss</th>
                      <th className="num">Frozen miss</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => {
                      const rec = recorded.get(r.date);
                      const recTok = rec?.tokens.find((t) => t.token === token);
                      const ours = recTok ? Math.abs(recTok.predicted / r.actualOpen - 1) * 100 : r.nightshiftErrBps / 100;
                      const frozen = r.staleErrBps / 100;
                      return (
                        <tr key={r.date}>
                          <td>{day(r.date)}</td>
                          <td className="num">{usd(r.prevClose)}</td>
                          <td className="num">{usd(recTok?.predicted ?? r.predictedOpen)}</td>
                          <td className="num">{usd(r.actualOpen)}</td>
                          <td className={`num ${ours < frozen ? "mint" : ""}`}>{ours.toFixed(2)}%</td>
                          <td className="num">{frozen.toFixed(2)}%</td>
                          <td className="small">
                            {recTok && rec ? (
                              <a href={rec.explorer} target="_blank" rel="noopener noreferrer">Recorded on Base ↗</a>
                            ) : (
                              <span className="muted" title="Rebuilt from market data: the call the engine would have made before that open">Replay</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="xs muted">
                &ldquo;Recorded on Base&rdquo; calls were written on-chain before the open, so they can&apos;t be changed. &ldquo;Replay&rdquo; rows rebuild the call
                from market data available before that open, for opens before the record started.
              </p>
            </>
          ) : (
            <div className="skeleton">Loading the track record…</div>
          )}
        </div>
      </section>
      </SignedInGate>
    </PageShell>
  );
}

/** Fair value (or live price) over the chosen window, with the last close and Nightshift's next call marked. */
function EtfChart({ token, lastClose, call, callLabel, marketOpen }: { token: string; lastClose?: number; call: number | null; callLabel: string | null; marketOpen: boolean }) {
  const [range, setRange] = useState<Range>("12H");
  const { data: series } = useApi<FairSeries>(`/api/series?token=${token}&range=${range}`, 120_000);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 1000, H = 300, PAD = { l: 10, r: 70, t: 16, b: 26 };

  const geo = useMemo(() => {
    const pts = series?.points ?? [];
    if (pts.length < 2) return null;
    const vs = [...pts.map((p) => p.v), ...(lastClose ? [lastClose] : []), ...(call ? [call] : [])];
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.12 || hi * 0.002;
    lo -= pad;
    hi += pad;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const area = `${line} L${x(t1).toFixed(1)},${H - PAD.b} L${x(t0).toFixed(1)},${H - PAD.b} Z`;
    const up = pts[pts.length - 1].v >= pts[0].v;
    return { pts, x, y, line, area, up, t0, t1 };
  }, [series, lastClose, call]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < geo.pts.length; i++) if (Math.abs(geo.x(geo.pts[i].t) - px) < Math.abs(geo.x(geo.pts[best].t) - px)) best = i;
    setHover(best);
  };
  const hp = geo && hover !== null ? geo.pts[hover] : null;

  return (
    <div className="panel etf-chart">
      <div className="etf-chart-head">
        <span className="small">
          {marketOpen ? "Live price" : series?.basis === "market" ? "Price" : "Nightshift fair value"}
          {hp ? <> · <b className="mono">{usd(hp.v)}</b> at {clock(hp.t)} ET</> : null}
        </span>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      {!geo ? (
        <div className="skeleton etf-chart-empty">Loading the chart…</div>
      ) : (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="etf-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${token} price chart`}>
          <defs>
            <linearGradient id="etf-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={geo.up ? "var(--mint)" : "var(--red)"} stopOpacity="0.22" />
              <stop offset="100%" stopColor={geo.up ? "var(--mint)" : "var(--red)"} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geo.area} fill="url(#etf-fill)" />
          <path d={geo.line} fill="none" stroke={geo.up ? "var(--mint)" : "var(--red)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {lastClose && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(lastClose)} y2={geo.y(lastClose)} stroke="var(--text-3)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
              <text x={W - PAD.r + 6} y={geo.y(lastClose) + 4} className="etf-svg-label">close {lastClose.toFixed(2)}</text>
            </g>
          )}
          {call && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(call)} y2={geo.y(call)} stroke="var(--amber)" strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
              <text x={W - PAD.r + 6} y={geo.y(call) + 4} className="etf-svg-label call">call {call.toFixed(2)}</text>
            </g>
          )}
          {hp && (
            <g>
              <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
              <circle cx={geo.x(hp.t)} cy={geo.y(hp.v)} r="5" fill={geo.up ? "var(--mint)" : "var(--red)"} />
            </g>
          )}
          <text x={PAD.l} y={H - 6} className="etf-svg-label">{clock(geo.t0)} ET</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" className="etf-svg-label">{clock(geo.t1)} ET</text>
        </svg>
      )}
      <p className="xs muted etf-legend">
        <span className="etf-key close" /> last close
        {call && <><span className="etf-key call" /> {callLabel}</>}
        {series?.source === "simulated" && <> · <span className="amber">simulated data: the live feed is unavailable</span></>}
      </p>
    </div>
  );
}
