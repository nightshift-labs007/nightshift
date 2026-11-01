"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Bucket } from "@/lib/types";

const W = 640;
const H = 170;
const PAD = { top: 22, bottom: 34, left: 40, right: 8 };

/** Do high-confidence baskets actually hit more often? Bars: actual hit rate. Ticks: what confidence promised. */
export function CalibrationChart({ buckets }: { buckets: Bucket[] }) {
  const t = useTranslations("scorecard");
  const [hover, setHover] = useState<string | null>(null);
  const slot = (W - PAD.left - PAD.right) / buckets.length;
  const bar = Math.min(56, slot - 16);
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom);
  const base = y(0);
  const h = buckets.find((b) => b.key === hover);

  return (
    <figure className="relative">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="w-full sm:w-auto">{t("calibration")}</span>
        <span className="flex items-center gap-1 sm:ml-auto"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-cool" /> {t("actual")}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 bg-paper" /> {t("expected")}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hit rate per confidence bucket against the confidence the model stated" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {t * 100}%
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = PAD.left + i * slot + slot / 2;
          const x = cx - bar / 2;
          const top = b.hit_rate === null ? base : y(b.hit_rate);
          const r = Math.min(4, base - top);
          const expected = b.mean_confidence ?? (Number(b.key.split("-")[0]) + Number(b.key.split("-")[1])) / 2;
          return (
            <g key={b.key} onMouseEnter={() => setHover(b.key)} tabIndex={0} onFocus={() => setHover(b.key)}>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} fill="transparent" />
              {b.hit_rate !== null && (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${base} Z`}
                  fill="var(--cool)"
                  opacity={hover === null || hover === b.key ? 1 : 0.45}
                />
              )}
              {b.n > 0 && (
                <>
                  <line x1={x - 4} x2={x + bar + 4} y1={y(expected)} y2={y(expected)} stroke="var(--paper)" strokeWidth={2} />
                  <text x={cx} y={Math.min(top, y(expected)) - 6} textAnchor="middle" fontSize="11" fill="var(--paper)" className="num">
                    {Math.round((b.hit_rate ?? 0) * 100)}%
                  </text>
                </>
              )}
              <text x={cx} y={H - 18} textAnchor="middle" fontSize="10" fill="var(--muted)">{b.key}</text>
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)" className="num">n={b.n}</text>
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-6 right-0 rounded-md border border-line bg-panel-2 p-2 text-xs shadow-lg">
          <p className="font-medium">Confidence {h.key}</p>
          <p className="num text-muted">
            hit rate {h.hit_rate === null ? "—" : `${Math.round(h.hit_rate * 100)}%`} on {h.n} baskets
            {h.mean_confidence !== null && ` · promised ${Math.round(h.mean_confidence * 100)}%`}
          </p>
        </div>
      )}
    </figure>
  );
}
