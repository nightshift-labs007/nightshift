"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SeverityChip } from "@/components/feed/SeverityChip";
import { Panel } from "@/components/ui/Panel";
import { Result } from "@/components/ui/Result";
import { etTime, pctPoints } from "@/lib/format";

export interface ReplayData {
  date: string;
  start: string;
  end: string;
  prev: string;
  next: string;
  events: { id: string; title: string; at: string; severity: number | null; category: string | null }[];
  baskets: {
    id: string;
    event_id: string;
    thesis: string;
    published_at: string;
    status: string;
    legs: { symbol: string; ticker: string; weight: number; entry: string }[];
    grade: { vs_spy_pct: string; ret_pct: string; hit: boolean } | null;
  }[];
  series: Record<string, [number, number][]>;
}

const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
const W = 640;
const H = 220;
const PAD = { top: 12, bottom: 22, left: 44, right: 56 };
const STEP = 5 * 60_000;

/** Value of a series at or before t. */
function at(series: [number, number][] | undefined, t: number): number | null {
  if (!series?.length) return null;
  let v: number | null = null;
  for (const [ts, px] of series) {
    if (ts > t) break;
    v = px;
  }
  return v;
}

export function NightReplay({ data }: { data: ReplayData }) {
  const t = useTranslations("replay");
  const start = new Date(data.start).getTime();
  const end = new Date(data.end).getTime();
  const [basketId, setBasketId] = useState(data.baskets[0]?.id ?? null);
  const [cursor, setCursor] = useState(end);
  const basket = data.baskets.find((b) => b.id === basketId) ?? null;

  // Lines: % move since the 16:00 ET close for each leg (fixed color order) plus SPY as a gray baseline.
  const lines = useMemo(() => {
    const symbols = [...(basket?.legs.map((l) => l.symbol) ?? []), "SPY"];
    return symbols.map((s, i) => {
      const raw = data.series[s] ?? [];
      const base = raw[0]?.[1];
      return {
        symbol: s,
        label: basket?.legs.find((l) => l.symbol === s)?.ticker ?? s,
        color: s === "SPY" ? "var(--muted)" : SERIES[i % SERIES.length]!,
        points: base ? raw.map(([ts, px]) => [ts, (px / base - 1) * 100] as [number, number]) : [],
      };
    });
  }, [basket, data.series]);

  const all = lines.flatMap((l) => l.points.map((p) => p[1]));
  const span = Math.max(0.5, ...all.map(Math.abs));
  const x = (ts: number) => PAD.left + ((ts - start) / (end - start)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((span - v) / (2 * span)) * (H - PAD.top - PAD.bottom);
  const events = data.events.filter((e) => new Date(e.at).getTime() <= cursor);

  // Direct labels at each line's end, pushed apart so they never overlap.
  const labels = lines
    .map((l) => {
      const last = l.points.filter((p) => p[0] <= cursor).at(-1);
      return last ? { symbol: l.symbol, label: l.label, x: x(last[0]) + 4, y: y(last[1]) + 3 } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i]!.y = Math.max(labels[i]!.y, labels[i - 1]!.y + 11);
  const published = basket ? new Date(basket.published_at).getTime() : null;

  return (
    <div className="space-y-4">
      {data.baskets.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("pick")}
          <select value={basketId ?? ""} onChange={(e) => setBasketId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-paper">
            {data.baskets.map((b) => (
              <option key={b.id} value={b.id}>{etTime(b.published_at)} · {b.legs.map((l) => l.ticker).join("/")}</option>
            ))}
          </select>
        </label>
      )}
      <Panel>
        <figure>
          <figcaption className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {lines.map((l) => (
              <span key={l.symbol} className="flex items-center gap-1">
                <i className="inline-block h-0.5 w-3" style={{ background: l.color }} /> {l.label}
              </span>
            ))}
          </figcaption>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Leg prices through the night, percent from the 16:00 ET close">
            {[span, 0, -span].map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : "2 4"} />
                <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{pctPoints(v, 1)}</text>
              </g>
            ))}
            {data.events.map((e) => (
              <line key={e.id} x1={x(new Date(e.at).getTime())} x2={x(new Date(e.at).getTime())} y1={H - PAD.bottom} y2={H - PAD.bottom + 6} stroke={(e.severity ?? 0) >= 3 ? "var(--hot)" : "var(--muted)"} strokeWidth={2} />
            ))}
            {published && <line x1={x(published)} x2={x(published)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--hot)" strokeDasharray="3 3" />}
            {lines.map((l) => (
              <g key={l.symbol}>
                <polyline
                  fill="none"
                  stroke={l.color}
                  strokeWidth={l.symbol === "SPY" ? 1.5 : 2}
                  strokeDasharray={l.symbol === "SPY" ? "4 3" : undefined}
                  points={l.points.filter((p) => p[0] <= cursor).map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}
                />
              </g>
            ))}
            {labels.map((l) => (
              <text key={l.symbol} x={l.x} y={l.y} fontSize="10" fill="var(--paper)">{l.label}</text>
            ))}
            <line x1={x(cursor)} x2={x(cursor)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--paper)" strokeOpacity={0.4} />
            <text x={PAD.left} y={H - 4} fontSize="10" fill="var(--muted)">{etTime(data.start)}</text>
            <text x={W - PAD.right} y={H - 4} fontSize="10" textAnchor="end" fill="var(--muted)">{etTime(data.end)}</text>
          </svg>
        </figure>
        <input
          type="range"
          min={start}
          max={end}
          step={STEP}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          className="mt-2 w-full accent-[var(--hot)]"
          aria-label={t("at", { time: etTime(new Date(cursor).toISOString()) })}
          aria-valuetext={etTime(new Date(cursor).toISOString())}
        />
        <p className="num text-xs text-muted">{t("at", { time: etTime(new Date(cursor).toISOString()) })}</p>
      </Panel>

      {basket && (
        <Panel accent="hot">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/b/${basket.id}`} className="text-sm hover:underline">{basket.thesis}</Link>
            <Result vsSpy={basket.grade?.vs_spy_pct ?? null} hit={basket.grade?.hit ?? null} />
          </div>
          <p className="mt-2 text-xs text-muted">{t("move")}</p>
          <ul className="num mt-1 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
            {basket.legs.map((l) => {
              const v = published && cursor >= published ? at(data.series[l.symbol], cursor) : null;
              return (
                <li key={l.symbol}>
                  <span className="font-mono">{l.ticker}</span> {v === null ? "—" : pctPoints((v / Number(l.entry) - 1) * 100)}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel>
        <p className="text-xs text-muted">{t("events")}</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="num shrink-0 text-xs text-muted">{etTime(e.at)}</span>
              <SeverityChip severity={e.severity} />
              <span>{e.title}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
