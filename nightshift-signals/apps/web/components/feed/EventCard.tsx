import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Result } from "@/components/ui/Result";
import { ago, weight } from "@/lib/format";
import type { FeedItem } from "@/lib/types";
import { SectorTags } from "./SectorTags";
import { SeverityChip } from "./SeverityChip";

export function EventCard({ item, fresh = false }: { item: FeedItem; fresh?: boolean }) {
  const t = useTranslations("feed");
  const locale = useLocale();
  const { event: e, basket: b } = item;
  return (
    <article className={`rounded-xl border bg-panel p-4 ${b ? "border-line border-l-2 border-l-hot" : "border-line"} ${fresh ? "arrive" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <SeverityChip severity={e.severity} corroborated={e.corroborated} />
        <SectorTags cat={e.category} regions={e.regions} />
        <span className="num ml-auto">
          {ago(e.first_seen_at)} · {t("sources", { n: e.sources_n })}
        </span>
      </div>
      <Link href={b ? `/b/${b.id}` : `/e/${e.id}`} className="mt-2 block font-display text-lg leading-snug font-medium hover:underline">
        {e.title}
      </Link>
      {b ? (
        <div className="mt-3 rounded-lg bg-panel-2 p-3">
          <p className="text-sm">{b.thesis_i18n?.[locale] ?? b.thesis}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {b.legs.map((l) => (
              <span key={l.ticker} className="num rounded border border-line px-1.5 py-0.5 font-mono text-xs">
                {l.ticker} {weight(l.weight)}
              </span>
            ))}
            <span className="num text-xs text-muted">{t("conf", { n: Math.round(b.confidence * 100) })}</span>
            {b.simulated && <span className="rounded bg-cool/15 px-1.5 py-0.5 text-[11px] text-cool">{t("simulated")}</span>}
            <span className="ml-auto">
              <Result vsSpy={b.grade?.vs_spy_pct ?? null} hit={b.grade?.hit ?? null} voidReason={b.void_reason} />
            </span>
          </div>
        </div>
      ) : (
        e.severity !== null && e.severity >= 3 && <p className="mt-2 text-xs text-muted">{t("noBasket")}</p>
      )}
    </article>
  );
}
