"use client";

import { useMemo, useState } from "react";
import { LOGOS } from "@/lib/logos";
import type { StockBoard, StockQuote } from "@/lib/stocks";
import { signed, usd } from "./useApi";
import { InfoTip } from "./InfoTip";

export function StockLogo({ q, size = 34 }: { q: Pick<StockQuote, "logo" | "ticker" | "name">; size?: number }) {
  const logo = q.logo ? LOGOS[q.logo] : null;
  return (
    <span className="st-logo" style={{ width: size, height: size, ["--brand" as string]: logo?.hex ?? "#c4ecd9" }} aria-hidden="true">
      {logo ? (
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5}>
          <path d={logo.path} fill="currentColor" />
        </svg>
      ) : (
        <b style={{ fontSize: size * 0.34 }}>{q.name.slice(0, 1)}</b>
      )}
    </span>
  );
}

export function Sparkline({ values, w = 120, h = 34 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className={`st-spark ${up ? "up" : "down"}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" strokeWidth="1.4" />
    </svg>
  );
}

const cls = (x: number) => (x >= 0 ? "up" : "down");

export function HeadlineCard({ q }: { q: StockQuote }) {
  return (
    <a className="card st-card" href={`/inspect#${q.ticker}`}>
      <div className="st-card-top">
        <StockLogo q={q} />
        <div>
          <b>{q.name}</b>
          <span className="mono">{q.ticker}</span>
        </div>
        <span className={`st-chip ${cls(q.dayChangePct)}`}>{signed(q.dayChangePct)}</span>
      </div>
      <div className="st-card-price">
        <span className="unit">{q.marketOpen ? "Live price" : "Nightshift fair value"}</span>
        <strong>{usd(q.fairValue)}</strong>
        <span className={`mono ${cls(q.driftPct)}`}>
          {q.marketOpen ? "Market open" : `${signed(q.driftPct)} vs close ${usd(q.lastClose)}`}
        </span>
      </div>
      <Sparkline values={q.spark} w={260} h={46} />
      <div className="st-card-meta mono">
        <span>Conf. {q.confidence} <InfoTip k="confidence" label="Conf." /></span>
        <span>β {q.beta.toFixed(2)}</span>
        <span>1M {signed(q.ret1mPct, 1)}</span>
      </div>
    </a>
  );
}

type Key = "name" | "price" | "fairValue" | "driftPct" | "dayChangePct" | "confidence" | "beta" | "ret1mPct" | "ret3mPct" | "vol30Pct";
const COLS: { k: Key; label: string; num?: boolean }[] = [
  { k: "name", label: "Company" },
  { k: "price", label: "Last trade", num: true },
  { k: "fairValue", label: "Nightshift value", num: true },
  { k: "driftPct", label: "Implied move", num: true },
  { k: "confidence", label: "Conf.", num: true },
  { k: "dayChangePct", label: "Last session", num: true },
  { k: "beta", label: "Beta", num: true },
  { k: "ret1mPct", label: "1M", num: true },
  { k: "ret3mPct", label: "3M", num: true },
  { k: "vol30Pct", label: "Vol (ann.)", num: true },
];

export function StockTable({ stocks, showSpark = true }: { stocks: StockQuote[]; showSpark?: boolean }) {
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return stocks;
    return [...stocks].sort((a, b) => {
      const x = a[sort.k];
      const y = b[sort.k];
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
    });
  }, [stocks, sort]);
  return (
    <div className="table-wrap st-table-wrap">
      <table className="st-table">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.k} className={c.num ? "num" : ""}>
                <button onClick={() => setSort((s) => ({ k: c.k, dir: s?.k === c.k && s.dir === -1 ? 1 : -1 }))}>
                  {c.label}
                  {sort?.k === c.k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                </button>
              </th>
            ))}
            {showSpark && <th>3 months</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.ticker} id={q.ticker}>
              <td>
                <span className="st-name">
                  <StockLogo q={q} size={28} />
                  <span>
                    <b>{q.name}</b>
                    <small className="mono">
                      {q.ticker} · {q.sector}
                    </small>
                  </span>
                </span>
              </td>
              <td className="num mono">{usd(q.price)}</td>
              <td className="num mono">{usd(q.fairValue)}</td>
              <td className={`num mono ${cls(q.driftPct)}`}>{q.marketOpen ? "open" : signed(q.driftPct)}</td>
              <td className="num mono">{q.confidence}</td>
              <td className={`num mono ${cls(q.dayChangePct)}`}>{signed(q.dayChangePct)}</td>
              <td className="num mono">{q.beta.toFixed(2)}</td>
              <td className={`num mono ${cls(q.ret1mPct)}`}>{signed(q.ret1mPct, 1)}</td>
              <td className={`num mono ${cls(q.ret3mPct)}`}>{signed(q.ret3mPct, 1)}</td>
              <td className="num mono">{q.vol30Pct.toFixed(0)}%</td>
              {showSpark && (
                <td>
                  <Sparkline values={q.spark} w={110} h={28} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Home-page section: the four headline stocks up front, every other tracked stock one click away. */
export function TopStocks({ board }: { board: StockBoard | null }) {
  const [all, setAll] = useState(false);
  if (!board) return <div className="skeleton">Loading stocks…</div>;
  const head = ["AAPL", "NVDA", "MSFT", "TSLA"].map((t) => board.stocks.find((s) => s.ticker === t)).filter((x): x is StockQuote => !!x);
  const rest = board.stocks.filter((s) => !head.includes(s));
  return (
    <>
      <div className="st-head-grid">
        {head.map((q) => (
          <HeadlineCard key={q.ticker} q={q} />
        ))}
      </div>
      <div className="st-more">
        <button className="btn secondary" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Hide the other stocks" : `View all ${board.stocks.length} stocks`}
        </button>
        <a className="link-btn" href="/inspect">
          Full analysis →
        </a>
        <span className="unit">
          {board.market.open ? "NYSE open" : "NYSE closed"} · {board.market.etTime}
        </span>
      </div>
      {all && <StockTable stocks={rest} />}
    </>
  );
}
