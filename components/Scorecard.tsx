"use client";

import { useState } from "react";
import { usd, useApi } from "./useApi";

type ReplayRow = { date: string; predictedOpen: number; actualOpen: number; nightshiftErrBps: number; staleErrBps: number };
type ShiftReport = { reports: { token: string; source: string; rows: ReplayRow[] }[] };
type LedgerFeed = {
  configured: boolean;
  accountUrl?: string;
  entries?: { session: string; explorer: string; lockedAt: string; tokens: { token: string; predicted: number; actual: number | null; errBps: number | null }[] }[];
};

type Graded = { token: string; date: string; predicted: number; actual: number; errBps: number; staleBps: number | null };
type Line = { token: string; n: number; avg: number; avgStale: number | null; beat: number; worst: Graded };

const mondayOf = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const fmtDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Per-token summary of one week's graded opens, worst miss included. */
function summarise(rows: Graded[]): Line[] {
  const by = new Map<string, Graded[]>();
  for (const r of rows) by.set(r.token, [...(by.get(r.token) ?? []), r]);
  return [...by.entries()].map(([token, xs]) => {
    const stale = xs.map((x) => x.staleBps).filter((x): x is number => x !== null);
    return {
      token,
      n: xs.length,
      avg: mean(xs.map((x) => x.errBps)),
      avgStale: stale.length ? mean(stale) : null,
      beat: xs.filter((x) => x.staleBps !== null && x.errBps <= x.staleBps).length,
      worst: xs.reduce((a, b) => (b.errBps > a.errBps ? b : a)),
    };
  });
}

function latestWeek(rows: Graded[]) {
  const weeks = [...new Set(rows.map((r) => mondayOf(r.date)))].sort();
  const week = weeks[weeks.length - 1];
  return week ? { week, rows: rows.filter((r) => mondayOf(r.date) === week) } : null;
}

function WeekTable({ lines }: { lines: Line[] }) {
  return (
    <div className="table-wrap panel">
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th className="num">Opens</th>
            <th className="num">Avg miss</th>
            <th className="num">Frozen feed</th>
            <th className="num">Beat frozen</th>
            <th>Worst miss</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.token}>
              <td className="mono">{l.token}</td>
              <td className="num">{l.n}</td>
              <td className="num">{l.avg.toFixed(1)} bps</td>
              <td className="num muted">{l.avgStale === null ? "—" : `${l.avgStale.toFixed(1)} bps`}</td>
              <td className="num">{l.avgStale === null ? "—" : `${l.beat} of ${l.n}`}</td>
              <td className="sc-worst">
                {fmtDay(l.worst.date)}: predicted {usd(l.worst.predicted)}, opened {usd(l.worst.actual)} ({l.worst.errBps.toFixed(1)} bps)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Headline({ lines, label }: { lines: Line[]; label: string }) {
  const all = lines.reduce((a, l) => a + l.n, 0);
  const avg = all ? lines.reduce((a, l) => a + l.avg * l.n, 0) / all : 0;
  const withStale = lines.filter((l) => l.avgStale !== null);
  const staleN = withStale.reduce((a, l) => a + l.n, 0);
  const stale = staleN ? withStale.reduce((a, l) => a + (l.avgStale ?? 0) * l.n, 0) / staleN : null;
  const beat = lines.reduce((a, l) => a + l.beat, 0);
  const worst = lines.map((l) => l.worst).reduce((a, b) => (b.errBps > a.errBps ? b : a));
  return (
    <div className="sc-stats">
      <div className="card sc-stat">
        <span className="unit">{label} · average miss</span>
        <strong>{avg.toFixed(1)} bps</strong>
        <span>{(avg / 100).toFixed(2)}% from the real open</span>
      </div>
      {stale !== null && (
        <div className="card sc-stat">
          <span className="unit">Frozen &ldquo;last close&rdquo; feed</span>
          <strong>{stale.toFixed(1)} bps</strong>
          <span>
            Nightshift was closer on {beat} of {staleN} opens
          </span>
        </div>
      )}
      <div className="card sc-stat miss">
        <span className="unit">Worst miss, shown on purpose</span>
        <strong>{worst.errBps.toFixed(1)} bps</strong>
        <span>
          {worst.token}, {fmtDay(worst.date)}
        </span>
      </div>
    </div>
  );
}

function threadText(week: string, lines: Line[], kind: string) {
  const parts = lines.map((l) => `${l.token}: avg miss ${l.avg.toFixed(1)} bps${l.avgStale !== null ? ` (frozen feed ${l.avgStale.toFixed(1)}), closer on ${l.beat}/${l.n}` : ""}`);
  const worst = lines.map((l) => l.worst).reduce((a, b) => (b.errBps > a.errBps ? b : a));
  return [
    `Nightshift Monday scorecard · week of ${fmtDay(week)} (${kind})`,
    "",
    "How close was our overnight price to the real 09:30 open?",
    ...parts,
    "",
    `Worst miss: ${worst.token} on ${fmtDay(worst.date)}, ${worst.errBps.toFixed(1)} bps. Misses included, every week.`,
    "1 bps = 0.01%. Data, not investment advice.",
    "nightshift.buzz/scorecard",
  ].join("\n");
}

export function Scorecard() {
  const { data: replay } = useApi<ShiftReport>("/api/shift-report", 600_000);
  const { data: ledger } = useApi<LedgerFeed>("/api/ledger", 600_000);
  const [copied, setCopied] = useState(false);

  const lockedRows: Graded[] = (ledger?.entries ?? []).flatMap((e) =>
    e.tokens.flatMap((t) => (t.actual !== null && t.errBps !== null ? [{ token: t.token, date: e.session, predicted: t.predicted, actual: t.actual, errBps: t.errBps, staleBps: null }] : [])),
  );
  const replayRows: Graded[] = (replay?.reports ?? [])
    .filter((r) => r.source === "live")
    .flatMap((r) => r.rows.map((x) => ({ token: r.token, date: x.date, predicted: x.predictedOpen, actual: x.actualOpen, errBps: x.nightshiftErrBps, staleBps: x.staleErrBps })));

  const locked = latestWeek(lockedRows);
  const replayed = latestWeek(replayRows);
  const lead = locked ?? replayed;
  const leadKind = locked ? "recorded on Base before each open" : "replay";

  async function copy() {
    if (!lead) return;
    try {
      await navigator.clipboard.writeText(threadText(lead.week, summarise(lead.rows), leadKind));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <>
      <section className="block">
        <div className="wrap">
          <div className="sc-head">
            <div>
              <span className="unit">Locked in advance · recorded on Base</span>
              <h2>{locked ? `Week of ${fmtDay(locked.week)}` : "The live record"}</h2>
            </div>
            {lead && (
              <button className="btn secondary small" onClick={copy}>
                {copied ? "Copied" : "Copy Monday thread"}
              </button>
            )}
          </div>
          {locked ? (
            <>
              <Headline lines={summarise(locked.rows)} label="Locked predictions" />
              <WeekTable lines={summarise(locked.rows)} />
              <p className="xs muted sc-note">
                Each prediction was recorded on Base before 09:30 ET, so it can&apos;t be changed after the open.{" "}
                {ledger?.accountUrl && (
                  <a href={ledger.accountUrl} target="_blank" rel="noopener noreferrer">
                    Every stamp on the explorer ↗
                  </a>
                )}
              </p>
            </>
          ) : (
            <div className="card panel sc-empty">
              {ledger === null
                ? "Loading the ledger…"
                : ledger.configured
                  ? "No graded stamps yet: the first one is graded after the next open."
                  : "This server isn't connected to the record on Base. On nightshift.buzz, predictions are stamped every weekday before the open and graded here."}
            </div>
          )}
        </div>
      </section>

      <section className="block alt">
        <div className="wrap">
          <div className="sc-head">
            <div>
              <span className="unit">Replay · recomputed, not locked in advance</span>
              <h2>{replayed ? `Week of ${fmtDay(replayed.week)}` : "Recent opens"}</h2>
            </div>
          </div>
          {replayed ? (
            <>
              <Headline lines={summarise(replayed.rows)} label="Replay" />
              <WeekTable lines={summarise(replayed.rows)} />
              <p className="xs muted sc-note">
                Each open is predicted again using only data available before it, then compared with the real open and with a frozen feed that
                still shows the previous close (what a traditional oracle reports overnight). A replay is a backtest, so the locked record above
                is the one to judge us by.
              </p>
            </>
          ) : (
            <div className="card panel sc-empty">{replay ? "Market data is unavailable right now." : "Loading…"}</div>
          )}
        </div>
      </section>
    </>
  );
}
