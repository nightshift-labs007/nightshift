import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { NightReplay, type ReplayData } from "@/components/replay/NightReplay";
import { Empty, Eyebrow } from "@/components/ui/Panel";
import { api, ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ReplayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const t = await getTranslations("replay");
  let data: ReplayData | null = null;
  try {
    data = await api<ReplayData>(`/replay/${date}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 400)) throw e;
  }
  return (
    <main className="space-y-4 pt-6">
      <div>
        <Eyebrow tone="cool">{t("eyebrow")}</Eyebrow>
        <h1 className="mt-1 font-display text-2xl font-semibold">{t("title", { date })}</h1>
        <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      </div>
      {data && (
        <div className="flex gap-3 text-xs">
          <Link className="text-cool underline" href={`/replay/${data.prev}`}>← {t("prev")}</Link>
          <Link className="text-cool underline" href={`/replay/${data.next}`}>{t("next")} →</Link>
        </div>
      )}
      {data && (data.events.length || data.baskets.length) ? <NightReplay data={data} /> : <Empty>{t("empty")}</Empty>}
    </main>
  );
}
