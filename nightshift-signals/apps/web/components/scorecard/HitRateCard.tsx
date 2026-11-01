import { useTranslations } from "next-intl";
import { Stat } from "@/components/ui/Panel";
import { pct, pctPoints } from "@/lib/format";
import type { ScorecardSummary } from "@/lib/types";

export function HitRateCard({ s }: { s: ScorecardSummary }) {
  const t = useTranslations("scorecard");
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label={t("hitRate")} value={s.hit_rate === null ? "—" : `${Math.round(s.hit_rate * 100)}%`} hint={t("graded", { n: s.graded })} />
      <Stat label={t("meanAlpha")} value={pct(s.mean_alpha)} hint={t("median", { v: pct(s.median_alpha) })} />
      <Stat label={t("meanReturn")} value={pct(s.mean_ret)} hint={t("afterSlip")} />
      <Stat label={t("worst")} value={s.worst ? pctPoints(s.worst.vs_spy_pct * 100) : "—"} hint={t("voids", { n: s.voids })} />
    </div>
  );
}
