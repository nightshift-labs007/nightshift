"use client";
import { useTranslations } from "next-intl";

const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export function SizeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useTranslations("trade");
  const i = Math.max(0, STEPS.indexOf(value));
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-muted">
        <span>{t("size")}</span>
        <span className="num font-mono text-paper">{value.toLocaleString()} USDG</span>
      </span>
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        value={i}
        onChange={(e) => onChange(STEPS[Number(e.target.value)]!)}
        className="mt-1 w-full accent-[var(--hot)]"
        aria-valuetext={`${value} USDG`}
      />
    </label>
  );
}
