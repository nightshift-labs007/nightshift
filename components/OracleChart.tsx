"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Quote } from "@/lib/oracle";
import type { FairSeries, Range } from "@/lib/series";
import { etParts } from "@/lib/time";
import { usd } from "./useApi";

const W = 760;
const H = 260;
const RANGES: Range[] = ["1H", "4H", "12H", "24H"];

const etLabel = (t: number) => {
  const p = etParts(t * 1000);
  return `${p.weekday} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET`;
};

export function OracleChart({ quotes }: { quotes: Quote[] }) {
  const [token, setToken] = useState("SPY");
  const [range, setRange] = useState<Range>("12H");
  const [series, setSeries] = useState<FairSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoverI, setHoverI] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const load = () =>
      fetch(`/api/series?token=${token}&range=${range}`)
        .then((r) => r.json())
        .then((s) => {
          if (alive && s.points) setSeries(s);
        })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    load();
    const id = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token, range]);

  const q = quotes.find((x) => x.token === token);
  const geo = useMemo(() => {
    if (!series || series.token !== token || series.points.length < 2) return null;
    const vs = series.points.map((p) => p.v);
    let lo = Math.min(...vs, series.lastClose);
    let hi = Math.max(...vs, series.lastClose);
    const pad = Math.max((hi - lo) * 0.18, hi * 0.0006);
    lo -= pad;
    hi += pad;
    const t0 = series.points[0].t;
    const t1 = series.points[series.points.length - 1].t;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
    const pts = series.points.map((p) => ({ ...p, x: x(p.t), y: y(p.v) }));
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    return {
      pts,
      line,
      area: `${line} V${H} H0Z`,
      closeY: y(series.lastClose),
      ticks: [0, 1, 2, 3].map((i) => hi - ((hi - lo) * (i + 0.5)) / 4),
      times: [0, 1, 2, 3, 4].map((i) => etLabel(t0 + ((t1 - t0) * i) / 4).replace(/^\w+ /, "")),
    };
  }, [series, token]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    geo.pts.forEach((p, i) => {
      if (Math.abs(p.x - xv) < Math.abs(geo.pts[best].x - xv)) best = i;
    });
    setHoverI(best);
  };

  const pt = geo ? geo.pts[hoverI ?? geo.pts.length - 1] : null;
  const change = pt && series ? (pt.v / series.lastClose - 1) * 100 : 0;

  return (
    <div className="panel chart-panel">
      <div className="chart-head">
        <div>
          <div className="unit">{series?.basis === "market" ? "Live market price" : "Anchor-implied fair value"} · 5-minute data</div>
          <div className="chart-value">
            <b>{pt ? usd(pt.v) : "—"}</b>
            <span className={change >= 0 ? "up" : "down"}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}% vs close
            </span>
          </div>
          <div className="xs muted mono">{pt ? etLabel(pt.t) : "loading"}{hoverI === null && q ? ` · oracle confidence ${q.confidence}` : ""}</div>
        </div>
        <div className="chart-controls">
          <div className="tabs">
            {quotes.map((x) => (
              <button key={x.token} className={`tab ${x.token === token ? "on" : ""}`} onClick={() => setToken(x.token)}>
                {x.token}
              </button>
            ))}
          </div>
          <div className="tabs">
            {RANGES.map((r) => (
              <button key={r} className={`tab ${r === range ? "on" : ""}`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`chart-body ${loading ? "is-loading" : ""}`}>
        <div className="chart-y">
          {(geo?.ticks ?? []).map((t, i) => (
            <span key={i}>{usd(t, t >= 1000 ? 0 : 2)}</span>
          ))}
        </div>
        <div className="chart-plot">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverI(null)}
            role="img"
            aria-label={`${token} fair value over the last ${range}`}
          >
            <defs>
              <linearGradient id="fv-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#eceef1" stopOpacity="0.1" />
                <stop offset="100%" stopColor="#eceef1" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="fv-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#6f727b" />
                <stop offset="100%" stopColor="#f3f3f4" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="grid-line" />
            ))}
            {geo && (
              <>
                <line x1="0" x2={W} y1={geo.closeY} y2={geo.closeY} className="close-line" />
                <path d={geo.area} fill="url(#fv-fill)" />
                <path d={geo.line} className="fv-line" key={`${token}-${range}`} />
                {pt && (
                  <>
                    <line x1={pt.x} x2={pt.x} y1="0" y2={H} className="cross" />
                    <circle cx={pt.x} cy={pt.y} r="4.5" className="fv-dot" />
                  </>
                )}
              </>
            )}
          </svg>
          {geo && (
            <span className="close-tag" style={{ top: `${(geo.closeY / H) * 100}%` }}>
              frozen close {series ? usd(series.lastClose) : ""}
            </span>
          )}
          <div className="chart-x">
            {(geo?.times ?? []).map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="xs muted" style={{ margin: "12px 0 0" }}>
        {series?.basis === "market"
          ? "Regular session: the ETF's own price."
          : "Last official close moved by its overnight anchor (futures or Bitcoin). The dashed line is what a frozen feed reports."}
        {series?.source === "simulated" ? " Live feed unavailable: simulated data." : ""}
      </p>
    </div>
  );
}
