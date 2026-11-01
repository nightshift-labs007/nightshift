import { FeedFilters } from "@/components/feed/FeedFilters";
import { LiveFeed } from "@/components/feed/LiveFeed";
import { OpenCountdown } from "@/components/feed/OpenCountdown";
import { Eyebrow } from "@/components/ui/Panel";
import { StaleBanner } from "@/components/ui/StaleBanner";
import { etParts, etToUtc, isUsEquityOpen, nextOpen } from "@nightshift-signals/core/market";
import { getTranslations } from "next-intl/server";
import { api } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FeedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const severity = Number(sp.severity ?? 2);
  const params = new URLSearchParams({ severity: String(severity), limit: "50" });
  if (sp.sector) params.set("sector", sp.sector);
  if (sp.region) params.set("region", sp.region);
  const { items } = await api<{ items: FeedItem[] }>(`/feed?${params}`);
  const t = await getTranslations("feed");
  const now = new Date();
  const openUntil = isUsEquityOpen(now) ? etToUtc(etParts(now).date, 16, 0).toISOString() : null;

  return (
    <main className="pt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="mt-1 font-display text-2xl font-semibold">{t("title")}</h1>
        </div>
        <OpenCountdown nextOpen={nextOpen(now).toISOString()} openUntil={openUntil} />
      </div>
      <div className="mt-4">
        <FeedFilters severity={severity} sector={sp.sector} region={sp.region} />
      </div>
      <StaleBanner />
      <div className="mt-4">
        <LiveFeed key={params.toString()} initial={items} filter={{ severity, sector: sp.sector, region: sp.region }} query={params.toString()} />
      </div>
    </main>
  );
}
