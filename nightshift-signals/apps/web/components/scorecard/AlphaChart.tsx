"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { pct } from "@/lib/format";
import type { ScorecardRow } from "@/lib/types";

const H = 160;
const PAD = { top: 12, bottom: 18, left: 44, right: 8 };

/** One bar per graded basket, oldest to newest: above zero beat SPY, below missed. */
export function AlphaChart({ rows }: { rows: ScorecardRow[] }) {
  const t = useTranslations("scorecard");
  const tr = useTranslations("result");
  const [hover, setHover] = useState<number | null>(null);
  const graded = rows.filter((r) => r.status === "graded").reverse();
  if (graded.length === 0) return null;
  const vals = graded.map((r) => Number(r.vs_spy_pct) * 100);
  const max = Math.max(0.5, ...vals.map(Math.abs));
  const W = 640;
  const plotW = W - PAD.left - PAD.right;
  const slot = plotW / graded.length;
  const bar = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => PAD.top + ((max - v) / (2 * max)) * (H - PAD.top - PAD.bottom);
  const zero = y(0);
  const r = Math.min(4, bar / 2);
  const h = hover === null ? null : graded[hover]!;

  return (
    <figure className="relative">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="w-full sm:w-auto">{t("alphaChart")}</span>
        <span className="flex items-center gap-1 sm:ml-auto"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-beat" /> ▲ {tr("beat")}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-miss" /> ▼ {tr("missed")}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Alpha versus SPY for each graded basket; the table below lists every value" onMouseLeave={() => setHover(null)}>
        {[max, 0, -max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" className="num">
              {t === 0 ? "0" : pct(t / 100, 1)}
            </text>
          </g>
        ))}
        {vals.map((v, i) => {
          const x = PAD.left + i * slot + (slot - bar) / 2;
          const top = v >= 0 ? y(v) : zero;
          const height = Math.max(1, Math.abs(y(v) - zero));
          // Rounded data end, square at the baseline.
          const d =
            v >= 0
              ? `M${x},${zero} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${zero} Z`
              : `M${x},${zero} V${zero + height - r} Q${x},${zero + height} ${x + r},${zero + height} H${x + bar - r} Q${x + bar},${zero + height} ${x + bar},${zero + height - r} V${zero} Z`;
          return (
            <g key={graded[i]!.basket_id} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} fill="transparent" />
              <path d={d} fill={v >= 0 ? "var(--beat)" : "var(--miss)"} opacity={hover === null || hover === i ? 1 : 0.45} />
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-6 right-0 max-w-[260px] rounded-md border border-line bg-panel-2 p-2 text-xs shadow-lg">
          <p className="num font-medium">
            {h.hit ? `▲ ${tr("beat")}` : `▼ ${tr("missed")}`} {pct(h.vs_spy_pct)}
          </p>
          <p className="mt-0.5 line-clamp-2 text-muted">{h.thesis}</p>
          <p className="num mt-0.5 text-muted">{h.published_at.slice(0, 10)} · conf {Math.round(h.confidence * 100)}%</p>
        </div>
      )}
    </figure>
  );
}
