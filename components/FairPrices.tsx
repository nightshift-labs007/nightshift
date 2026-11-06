"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShiftReport } from "@/lib/backtest";
import type { OracleSnapshot, Quote } from "@/lib/oracle";
import { etParts, etToUtcMs, nextSessionDate } from "@/lib/time";
import { CountUp } from "./CountUp";
import { InfoTip } from "./InfoTip";
import { signed, usd, useApi } from "./useApi";

type LedgerToken = { token: string; predicted: number; confidence: number | null; actual: number | null; errBps: number | null };
type LedgerEntry = { txId: string; explorer: string; lockedAt: string; session: string; tokens: LedgerToken[] };
type Ledger = { configured: boolean; accountUrl?: string; entries?: LedgerEntry[] };

/** Our call for one token: the prediction recorded on Base before an open (or, without a stamp, the replay). */
type Call = {
  session: string;
  predicted: number;
  actual: number | null;
  errPct: number | null;
  frozenErrPct: number | null;
  lockedAt: string | null;
  explorer: string | null;
};

const ET = "America/New_York";
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const etTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ET }) + " ET";
const confWord = (c: number) => (c >= 80 ? "High" : c >= 60 ? "Medium" : "Low");
const confColor = (c: number) => (c >= 80 ? "var(--mint)" : c >= 60 ? "var(--amber)" : "var(--red)");

function until(ms: number) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Latest call per token: the newest recorded call first (graded or still pending), else the newest replayed open. */
function latestCalls(ledger: Ledger | null, shift: { reports: ShiftReport[] } | null): Record<string, { last: Call | null; pending: Call | null }> {
  const out: Record<string, { last: Call | null; pending: Call | null }> = {};
  const prevClose = new Map<string, number>(); // "SPY|2026-11-02" → the close before that open
  for (const r of shift?.reports ?? []) for (const row of r.rows) prevClose.set(`${r.token}|${row.date}`, row.prevClose);
  const frozen = (token: string, session: string, actual: number | null) => {
    const pc = prevClose.get(`${token}|${session}`);
    return pc && actual ? Math.abs(pc / actual - 1) * 100 : null;
  };
  const today = etParts(Date.now()).date;
  for (const e of ledger?.entries ?? []) {
    for (const t of e.tokens) {
      const slot = (out[t.token] ??= { last: null, pending: null });
      const call: Call = {
        session: e.session,
        predicted: t.predicted,
        actual: t.actual,
        errPct: t.errBps === null ? null : t.errBps / 100,
        frozenErrPct: frozen(t.token, e.session, t.actual),
        lockedAt: e.lockedAt,
        explorer: e.explorer,
      };
      if (t.actual === null) {
        if (!slot.pending && !slot.last && e.session >= today) slot.pending = call; // newest stamp, open not reached yet
      } else if (!slot.last) slot.last = call;
    }
  }
  for (const r of shift?.reports ?? []) {
    const slot = (out[r.token] ??= { last: null, pending: null });
    const row = r.rows[0]; // newest first
    if (slot.last || !row) continue;
    slot.last = {
      session: row.date,
      predicted: row.predictedOpen,
      actual: row.actualOpen,
      errPct: row.nightshiftErrBps / 100,
      frozenErrPct: row.staleErrBps / 100,
      lockedAt: null,
      explorer: null,
    };
  }
  return out;
}

/** One ETF as a row of the stacked list; the whole row opens the ETF's page (chart and every past call). */
function PriceRow({ q, call }: { q: Quote; call?: { last: Call | null; pending: Call | null } }) {
  const c = call?.pending ?? call?.last ?? null;
  const beat = c && c.errPct !== null && c.frozenErrPct !== null && c.errPct < c.frozenErrPct;
  return (
    <Link className="fp-row" href={`/etf/${q.token}`} role="listitem">
      <span className="fp-row-id">
        <b className="mono">{q.token}</b>
        <small>{q.name}</small>
      </span>
      <span className="num fp-row-price">
        <b>{usd(q.fairValue)}</b>
        <small className={q.source === "live" ? "muted" : "amber"}>{q.marketOpen ? "live price" : q.source === "live" ? "fair value" : "simulated"}</small>
      </span>
      <span className={`num mono ${q.driftPct >= 0 ? "up" : "down"}`}>{signed(q.driftPct)}</span>
      {q.marketOpen ? (
        <span className="num mono">{usd(q.lastClose)}</span>
      ) : (
        <span className="num fp-row-conf">
          <span className="mono" style={{ color: confColor(q.confidence) }}>{q.confidence}</span>
          <span className="fp-row-meter" aria-hidden="true"><i style={{ width: `${q.confidence}%`, background: confColor(q.confidence) }} /></span>
        </span>
      )}
      <span className="fp-row-call small">
        {!c ? (
          <span className="muted">—</span>
        ) : call?.pending ? (
          <>
            {dayLabel(c.session)} open: <b className="mono">{usd(c.predicted)}</b> <span className="muted">· graded at 09:30 ET</span>
          </>
        ) : (
          <>
            {dayLabel(c.session)}: <b className="mono">{usd(c.predicted)}</b> → {c.actual !== null ? <span className="mono">{usd(c.actual)}</span> : "…"}
            {c.errPct !== null && (
              <span className={beat ? "mint" : "muted"}>
                {" "}· missed {c.errPct.toFixed(2)}%{c.frozenErrPct !== null ? ` (frozen ${c.frozenErrPct.toFixed(2)}%)` : ""}
              </span>
            )}
          </>
        )}
      </span>
      <span className="fp-row-go" aria-hidden="true">→</span>
    </Link>
  );
}

/** The App's first tab: what each ETF is worth right now, how sure we are, and how our last call did. */
export function FairPrices({ snap }: { snap: OracleSnapshot | null }) {
  const ledger = useApi<Ledger>("/api/ledger", 600_000).data;
  const shift = useApi<{ reports: ShiftReport[] }>("/api/shift-report", 600_000).data;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 60_000); // keep the countdown fresh
    return () => clearInterval(id);
  }, []);

  if (!snap) return <div className="skeleton">Loading prices<span className="blink">…</span></div>;

  const open = snap.market.open;
  const calls = latestCalls(ledger, shift);
  const nextOpen = etToUtcMs(nextSessionDate(), 9, 30);
  // headline: how the last graded open went across all tokens
  const graded = Object.values(calls).map((c) => c.last).filter((c): c is Call => !!c && c.errPct !== null && c.frozenErrPct !== null);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const anySim = snap.quotes.some((q) => q.source === "simulated");

  return (
    <div className="fp">
      <div className={`panel fp-status ${open ? "open" : "closed"}`}>
        <div className="fp-status-main">
          <span className="fp-dot" aria-hidden />
          <div>
            <div className="mono xs muted">
              {snap.market.etTime} · {snap.market.phase}
            </div>
            <h2>{open ? "Wall Street is open." : "Wall Street is closed."}</h2>
            <p>
              {open
                ? "These are the real market prices. When the market closes at 16:00 ET, Nightshift takes over with a fair value for every token."
                : "Tokens still trade, but a normal price feed is frozen at the last close. Nightshift shows what each ETF is worth right now, and how sure it is."}
            </p>
          </div>
        </div>
        <div className="fp-status-side">
          {open ? (
            <>
              <span className="xs muted">Fair value takes over</span>
              <b>16:00 ET</b>
            </>
          ) : (
            <>
              <span className="xs muted">Next open</span>
              <b>{dayLabel(nextSessionDate())} 09:30 ET</b>
              <span className="xs muted">in {until(nextOpen)}</span>
            </>
          )}
        </div>
      </div>

      {graded.length > 0 && (
        <div className="fp-score">
          <span>
            Last open: our calls missed by <b className="mint">{avg(graded.map((c) => c.errPct!)).toFixed(2)}%</b> on average.
            A frozen price missed by <b>{avg(graded.map((c) => c.frozenErrPct!)).toFixed(2)}%</b>.
          </span>
          <Link href="/etf/SPY">Every past call →</Link>
        </div>
      )}

      {anySim && (
        <div className="panel red small">
          Some market feeds couldn&apos;t be reached, so those tokens show <b className="amber">simulated</b> prices.
        </div>
      )}

      <div className="fp-stack" role="list">
        <div className="fp-row fp-row-head" aria-hidden="true">
          <span>ETF</span>
          <span className="num">{open ? "Price" : "Fair value"}</span>
          <span className="num">{open ? "Today" : "Expected move"}</span>
          <span className="num">{open ? "Last close" : "Confidence"}</span>
          <span>Our last call</span>
          <span />
        </div>
        {snap.quotes.map((q) => (
          <PriceRow key={q.token} q={q} call={calls[q.token]} />
        ))}
      </div>

      <div className="fp-foot small muted">
        <span>
          <b>How to read this:</b> fair value is our estimate of where each ETF would trade if Wall Street were open, built from markets that
          never close (futures, gold, bitcoin, Asia and Europe, news). Confidence drops the longer the market is closed or when something
          unusual happens. Every weekday before the open, our predicted open is recorded on Base so nobody can change it later.
        </span>
        <span className="fp-links">
          <Link href="/oracle">See how each price is built →</Link>
          <a href="#vault">Borrow against these prices →</a>
        </span>
      </div>
    </div>
  );
}
