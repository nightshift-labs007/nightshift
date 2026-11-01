import { CATEGORIES } from "@nightshift-signals/core/enums";
import { getTranslations } from "next-intl/server";
import { ScorecardView, type CrowdSummary } from "@/components/scorecard/ScorecardView";
import { Eyebrow, Panel } from "@/components/ui/Panel";
import { api, API_URL } from "@/lib/api";
import type { ScorecardRow, ScorecardSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scorecard" };

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ sector?: string }> }) {
  const { sector } = await searchParams;
  const q = sector ? `?sector=${sector}` : "";
  const [data, crowd] = await Promise.all([
    api<{ summary: ScorecardSummary; rows: ScorecardRow[]; disabled_categories: { category: string; reason: string }[] }>(`/scorecard${q}`),
    api<CrowdSummary>("/scorecard/crowd"),
  ]);
  const [t, tc, tf] = [await getTranslations("scorecard"), await getTranslations("categories"), await getTranslations("feed")];
  return (
    <main className="space-y-4 pt-6">
      <div>
        <Eyebrow tone="cool">{t("eyebrow")}</Eyebrow>
        <h1 className="mt-1 font-display text-2xl leading-tight font-semibold text-balance">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      </div>
      <form className="flex flex-wrap items-center gap-2 text-xs" action="/scorecard">
        <select name="sector" defaultValue={sector ?? ""} aria-label={tf("allSectors")} className="rounded-md border border-line bg-panel px-2 py-1">
          <option value="">{tf("allSectors")}</option>
          {CATEGORIES.filter((c) => c !== "other").map((c) => (
            <option key={c} value={c}>{tc(c)}</option>
          ))}
        </select>
        <button className="rounded-md border border-line px-2 py-1">{t("apply")}</button>
        <a className="ml-auto text-cool underline" href={`${API_URL}/v1/scorecard.csv${q}`}>{t("csv")}</a>
        <span className="w-full text-muted">{t("recompute")}</span>
      </form>
      {data.disabled_categories.length > 0 && (
        <Panel>
          <p className="text-xs text-muted">{t("disabled")}</p>
          <ul className="mt-1 text-sm">
            {data.disabled_categories.map((d) => (
              <li key={d.category}>
                {tc(d.category)} <span className="text-xs text-muted">· {d.reason}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <ScorecardView summary={data.summary} rows={data.rows} crowd={crowd} />
    </main>
  );
}
