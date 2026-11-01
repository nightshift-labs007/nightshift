import { getTranslations } from "next-intl/server";
import { ScorecardView } from "@/components/scorecard/ScorecardView";
import { Eyebrow } from "@/components/ui/Panel";
import { api } from "@/lib/api";
import type { ScorecardRow, ScorecardSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MorningReport({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const { summary, rows } = await api<{ summary: ScorecardSummary; rows: ScorecardRow[] }>(`/scorecard/${date}`);
  const t = await getTranslations("scorecard");
  return (
    <main className="space-y-4 pt-6">
      <div>
        <Eyebrow tone="cool">{t("morning")}</Eyebrow>
        <h1 className="mt-1 font-display text-2xl font-semibold">{t("morningTitle", { date })}</h1>
      </div>
      <ScorecardView summary={summary} rows={rows} />
    </main>
  );
}
