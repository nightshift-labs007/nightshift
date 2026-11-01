import { getTranslations } from "next-intl/server";
import { Empty, Eyebrow } from "@/components/ui/Panel";
import { api } from "@/lib/api";
import { bps, price } from "@/lib/format";
import type { FairValue } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fair-value radar" };

/** Every token's gap to off-hours fair value. The number is always printed; color only reinforces it. */
export default async function RadarPage() {
  const { items } = await api<{ items: FairValue[] }>("/fairvalue");
  const t = await getTranslations("radar");
  const sorted = [...items].sort((a, b) => Math.abs(b.gap_bps) - Math.abs(a.gap_bps));
  return (
    <main className="space-y-4 pt-6">
      <div>
        <Eyebrow tone="cool">{t("eyebrow")}</Eyebrow>
        <h1 className="mt-1 font-display text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      </div>
      {sorted.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sorted.map((g) => {
            const strength = Math.min(1, Math.abs(g.gap_bps) / 300);
            const tint = g.gap_bps > 0 ? "var(--s2)" : "var(--s1)";
            return (
              <div
                key={g.symbol}
                className="rounded-lg border border-line p-3"
                style={{ background: `color-mix(in oklab, ${tint} ${Math.round(strength * 35)}%, var(--panel))` }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-sm font-medium">{g.underlying}</span>
                  {g.frozen && <span className="text-[10px] text-muted">{t("frozen")}</span>}
                </div>
                <p className={`num mt-1 font-display text-xl font-semibold ${Math.abs(g.gap_bps) > 150 ? "underline decoration-2 underline-offset-4" : ""}`}>{bps(g.gap_bps)}</p>
                <p className="num text-[11px] text-muted">
                  {g.gap_bps > 0 ? t("rich") : g.gap_bps < 0 ? t("cheap") : "±"} · {price(g.mid)} / {price(g.fv)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
