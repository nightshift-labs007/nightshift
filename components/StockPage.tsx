"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { StockBoard, StockDetail, StockRange } from "@/lib/stocks";
import { InfoTip } from "./InfoTip";
import { PageShell } from "./Site";
import { SignedInGate } from "./SignedIn";
import { StockLogo } from "./Stocks";
import { signed, usd, useApi } from "./useApi";

const STOCK_RANGES: StockRange[] = ["1D", "5D", "1M", "3M"];
const ET = "America/New_York";
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (t: number, range: StockRange) =>
  range === "1D"
    ? new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }) + " ET"
    : new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(range === "5D" ? { hour: "numeric" } : {}), timeZone: ET });
const confColor = (c: number) => (c >= 80 ? "var(--mint)" : c >= 60 ? "var(--amber)" : "var(--red)");
const cls = (x: number) => (x >= 0 ? "up" : "down");

/**
 * One stock: its price now (or Nightshift's fair value after the bell), a chart where the line carries on past the close
 * as the fair value, the Nightshift report in plain words, and the last few weeks of open calls graded.
 */
export function StockPage({ ticker }: { ticker: string }) {
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  const [range, setRange] = useState<StockRange>("1D");
  const { data: detail } = useApi<StockDetail>(`/api/stocks/${ticker}?range=${range}`, 120_000);
  const q = board?.stocks.find((s) => s.ticker === ticker);
  const others = (board?.stocks ?? []).filter((s) => s.ticker !== ticker).slice(0, 8);

  return (
    <PageShell>
      <SignedInGate what="the full stock report">
        <section className="block etf-top">
          <div className="wrap">
            <Link className="etf-back" href="/#stocks">← All stocks</Link>
            <div className="etf-head">
              <div>
                <p className="mono xs muted">{board ? `${board.market.etTime} · ${board.market.open ? "WALL STREET OPEN" : "WALL STREET CLOSED"}` : "Loading…"}</p>
                <h1 className="sp-title">
                  {q && <StockLogo q={q} size={44} />}
                  <span>
                    {q?.name ?? ticker} <span className="etf-name mono">{ticker}{q ? ` · ${q.sector}` : ""}</span>
                  </span>
                </h1>
                {q ? (
                  <div className="etf-price">
                    <b>{usd(q.fairValue)}</b>
                    <span className={cls(q.marketOpen ? q.dayChangePct : q.driftPct)}>{signed(q.marketOpen ? q.dayChangePct : q.driftPct)}</span>
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
          </div>
        </section>

        <section className="block etf-chart-block">
          <div className="wrap">
            <StockChart ticker={ticker} detail={detail?.range === range ? detail : null} range={range} setRange={setRange} />
          </div>
        </section>

        {q && (
          <section className="block">
            <div className="wrap">
              <h3 className="sub-title">Nightshift report</h3>
              <p className="sp-summary">
                {q.marketOpen ? (
                  <>
                    Wall Street is open, so {q.name} trades at its real price: <b>{usd(q.price)}</b>, {signed(q.dayChangePct)} on the day. When the bell rings,
                    Nightshift takes over and keeps pricing it from {q.anchorName}, which trade almost around the clock.
                  </>
                ) : (
                  <>
                    Since the close at <b>{usd(q.lastClose)}</b>, {q.anchorName} have moved <b className={cls(q.anchorMovePct)}>{signed(q.anchorMovePct)}</b>. {q.name} usually
                    moves about <b>{q.beta.toFixed(2)}×</b> as much, so Nightshift puts it at <b>{usd(q.fairValue)}</b> ({signed(q.driftPct)}) with{" "}
                    <b>{q.confidence}/100</b> confidence.
                    {q.extended && (
                      <> The latest after-hours trade was {usd(q.extended.price)}, {Math.abs(q.extended.vsFairBps / 100).toFixed(2)}% {q.extended.vsFairBps >= 0 ? "above" : "below"} our value.</>
                    )}
                  </>
                )}
              </p>
              <div className="sp-stats">
                <Stat label="Last close" value={usd(q.lastClose)} />
                <Stat label={q.marketOpen ? "Live price" : "Fair value now"} value={usd(q.fairValue)} />
                <Stat label="Implied move" value={q.marketOpen ? "open" : signed(q.driftPct)} tone={q.marketOpen ? undefined : q.driftPct} />
                <Stat label="Confidence" value={`${q.confidence}/100`} />
                <Stat label={`Beta to ${q.anchorName.replace(" futures", "")}`} value={q.beta.toFixed(2)} hint="How much the stock tends to move for each 1% move in the index." />
                <Stat label="How closely it follows" value={`${Math.round(q.r2 * 100)}%`} hint="Share of the stock's daily moves the index explains. Higher means the overnight estimate is more reliable." />
                <Stat label="Last session" value={signed(q.dayChangePct)} tone={q.dayChangePct} />
                <Stat label="1 month" value={signed(q.ret1mPct, 1)} tone={q.ret1mPct} />
                <Stat label="3 months" value={signed(q.ret3mPct, 1)} tone={q.ret3mPct} />
                <Stat label="Volatility (yearly)" value={`${q.vol30Pct.toFixed(0)}%`} />
                <Stat label="From 3-month high" value={signed(q.offHighPct, 1)} tone={q.offHighPct} />
                {q.extended && <Stat label="After-hours trade" value={usd(q.extended.price)} hint={`At ${new Date(q.extended.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET`} />}
              </div>
            </div>
          </section>
        )}

        <section className="block alt">
          <div className="wrap">
            <h3 className="sub-title">Every recent open, called and graded</h3>
            {detail?.calls.length ? (
              <>
                <div className="etf-score">
                  <div><span className="xs muted">Our average miss</span><b className={`mono ${detail.avgNightshiftBps < detail.avgStaleBps ? "mint" : ""}`}>{(detail.avgNightshiftBps / 100).toFixed(2)}%</b></div>
                  <div><span className="xs muted">A frozen price&apos;s average miss</span><b className="mono">{(detail.avgStaleBps / 100).toFixed(2)}%</b></div>
                  <div><span className="xs muted">Closer than the frozen price</span><b className="mono">{detail.wins} of {detail.calls.length}</b></div>
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
                      </tr>
                    </thead>
                    <tbody>
                      {detail.calls.map((c) => (
                        <tr key={c.date}>
                          <td>{day(c.date)}</td>
                          <td className="num">{usd(c.prevClose)}</td>
                          <td className="num">{usd(c.predictedOpen)}</td>
                          <td className="num">{usd(c.actualOpen)}</td>
                          <td className={`num ${c.nightshiftErrBps < c.staleErrBps ? "mint" : ""}`}>{(c.nightshiftErrBps / 100).toFixed(2)}%</td>
                          <td className="num">{(c.staleErrBps / 100).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="xs muted">
                  Each call is rebuilt from data available before that 09:30 ET open: the last close moved by {q?.anchorName ?? "the index future"} times the stock&apos;s
                  beta. The &ldquo;frozen price&rdquo; is what most feeds show overnight: the last close, unchanged.
                </p>
              </>
            ) : (
              <div className="skeleton">{detail ? "No graded opens yet." : "Loading the track record…"}</div>
            )}
          </div>
        </section>

        {others.length > 0 && (
          <section className="block">
            <div className="wrap">
              <h3 className="sub-title">Other stocks</h3>
              <div className="sp-others">
                {others.map((s) => (
                  <Link key={s.ticker} href={`/stock/${s.ticker}`} className="panel sp-other">
                    <StockLogo q={s} size={28} />
                    <span>
                      <b>{s.name}</b>
                      <small className="mono">{usd(s.fairValue)} <span className={cls(s.marketOpen ? s.dayChangePct : s.driftPct)}>{signed(s.marketOpen ? s.dayChangePct : s.driftPct)}</span></small>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </SignedInGate>
    </PageShell>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: number; hint?: string }) {
  return (
    <div title={hint}>
      <span className="xs muted">{label}</span>
      <b className={`mono ${tone === undefined ? "" : cls(tone)}`}>{value}</b>
    </div>
  );
}

/** Price over the window; after the last close the line turns amber and dashed: that part is Nightshift's fair value. */
function StockChart({ ticker, detail, range, setRange }: { ticker: string; detail: StockDetail | null; range: StockRange; setRange: (r: StockRange) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 1000, H = 300, PAD = { l: 10, r: 80, t: 16, b: 26 };

  const geo = useMemo(() => {
    const pts = detail?.points ?? [];
    if (pts.length < 2) return null;
    const vs = [...pts.map((p) => p.v), detail!.lastClose];
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.12 || hi * 0.002;
    lo -= pad;
    hi += pad;
    // even spacing by index: nights and weekends don't stretch the line flat
    const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const split = pts.findIndex((p) => p.fair);
    const marketEnd = split === -1 ? pts.length : split; // fair tail starts at the close point just before it
    const path = (from: number, to: number) => pts.slice(from, to).map((p, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const market = path(0, marketEnd);
    const fair = split === -1 ? null : path(Math.max(0, split - 1), pts.length);
    const area = `${market} L${x(marketEnd - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`;
    const up = pts[marketEnd - 1].v >= pts[0].v;
    return { pts, x, y, market, fair, area, up };
  }, [detail]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(geo.pts.length - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (geo.pts.length - 1)))));
  };
  const hp = geo && hover !== null ? geo.pts[hover] : null;
  const color = geo?.up ? "var(--mint)" : "var(--red)";

  return (
    <div className="panel etf-chart">
      <div className="etf-chart-head">
        <span className="small">
          {hp ? <>{hp.fair ? "Nightshift fair value" : "Price"} · <b className="mono">{usd(hp.v)}</b> · {stamp(hp.t, range)}</> : "Price, then Nightshift fair value after the close"}
        </span>
        <div className="seg">
          {STOCK_RANGES.map((r) => (
            <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      {!geo ? (
        <div className="skeleton etf-chart-empty">Loading the chart…</div>
      ) : (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="etf-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${ticker} price chart`}>
          <defs>
            <linearGradient id="sp-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geo.area} fill="url(#sp-fill)" />
          <path d={geo.market} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {geo.fair && <path d={geo.fair} fill="none" stroke="var(--amber)" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
          <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(detail!.lastClose)} y2={geo.y(detail!.lastClose)} stroke="var(--text-3)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          <text x={W - PAD.r + 6} y={geo.y(detail!.lastClose) + 4} className="etf-svg-label">close {detail!.lastClose.toFixed(2)}</text>
          {geo.fair && (
            <text x={W - PAD.r + 6} y={geo.y(geo.pts[geo.pts.length - 1].v) + (geo.pts[geo.pts.length - 1].v >= detail!.lastClose ? -8 : 18)} className="etf-svg-label call">
              now {geo.pts[geo.pts.length - 1].v.toFixed(2)}
            </text>
          )}
          {hp && hover !== null && (
            <g>
              <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
              <circle cx={geo.x(hover)} cy={geo.y(hp.v)} r="5" fill={hp.fair ? "var(--amber)" : color} />
            </g>
          )}
          <text x={PAD.l} y={H - 6} className="etf-svg-label">{stamp(geo.pts[0].t, range)}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" className="etf-svg-label">{stamp(geo.pts[geo.pts.length - 1].t, range)}</text>
        </svg>
      )}
      <p className="xs muted etf-legend">
        <span className="etf-key close" /> last close
        {geo?.fair && <><span className="etf-key call" /> Nightshift fair value since the close</>}
      </p>
    </div>
  );
}
