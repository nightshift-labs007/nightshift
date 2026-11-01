import { addDays } from "@nightshift-signals/core/market";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Empty, Eyebrow, Panel } from "@/components/ui/Panel";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "League" };

interface LeagueRow {
  rank: number;
  handle: string;
  pnl_usdg: number;
  positions: number;
  beat_spy: number;
  streak: number;
  badges: string[];
}

export default async function LeaguePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const data = await api<{ week: string; rules: string; rows: LeagueRow[] }>(`/league${week ? `?week=${week}` : ""}`);
  const t = await getTranslations("league");
  const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(2)} USDG`;
  return (
    <main className="space-y-4 pt-6">
      <div>
        <Eyebrow tone="cool">{t("eyebrow")}</Eyebrow>
        <h1 className="mt-1 font-display text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("rules")}</p>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <Link className="text-cool underline" href={`/league?week=${addDays(data.week, -7)}`}>← {t("prev")}</Link>
        <span className="num text-muted">{t("week", { date: data.week })}</span>
        <Link className="text-cool underline" href={`/league?week=${addDays(data.week, 7)}`}>{t("next")} →</Link>
      </div>
      {data.rows.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted">
                  <th className="pb-2 font-normal">{t("rank")}</th>
                  <th className="pb-2 font-normal">{t("trader")}</th>
                  <th className="pb-2 text-right font-normal">{t("pnl")}</th>
                  <th className="pb-2 text-right font-normal">{t("beat")}</th>
                  <th className="pb-2 text-right font-normal">{t("streak")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.handle} className="border-t border-line align-top">
                    <td className="num py-2 pr-2 text-muted">{r.rank}</td>
                    <td className="py-2 pr-2">
                      <p className="font-medium">{r.handle}</p>
                      <p className="flex flex-wrap gap-1">
                        {r.badges.map((b) => (
                          <span key={b} className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">{t(`badges.${b}`)}</span>
                        ))}
                      </p>
                    </td>
                    <td className="num py-2 pr-2 text-right">{money(r.pnl_usdg)}</td>
                    <td className="num py-2 pr-2 text-right">{r.beat_spy}/{r.positions}</td>
                    <td className="num py-2 text-right">{r.streak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}
