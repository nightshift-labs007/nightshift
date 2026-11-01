import { useTranslations } from "next-intl";
import { Empty, Panel } from "@/components/ui/Panel";
import type { ScorecardRow, ScorecardSummary } from "@/lib/types";
import { AlphaChart } from "./AlphaChart";
import { BasketTable } from "./BasketTable";
import { CalibrationChart } from "./CalibrationChart";
import { HitRateCard } from "./HitRateCard";

export interface CrowdSummary {
  baskets: number;
  crowd_hit_rate: number | null;
  ai_hit_rate: number | null;
}

const rate = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export function ScorecardView({ summary, rows, crowd }: { summary: ScorecardSummary; rows: ScorecardRow[]; crowd?: CrowdSummary }) {
  const t = useTranslations("scorecard");
  if (rows.length === 0) return <Empty>{t("empty")}</Empty>;
  return (
    <div className="space-y-4">
      <HitRateCard s={summary} />
      {crowd && crowd.baskets > 0 && (
        <Panel>
          <p className="text-xs text-muted">{t("crowd")}</p>
          <p className="num mt-1 text-sm">{t("crowdLine", { n: crowd.baskets, crowd: rate(crowd.crowd_hit_rate), ai: rate(crowd.ai_hit_rate) })}</p>
        </Panel>
      )}
      <Panel>
        <AlphaChart rows={rows} />
      </Panel>
      <Panel>
        <CalibrationChart buckets={summary.by_confidence} />
      </Panel>
      <Panel>
        <BasketTable rows={rows} />
      </Panel>
    </div>
  );
}
