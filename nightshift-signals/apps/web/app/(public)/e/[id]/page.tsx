import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventCard } from "@/components/feed/EventCard";
import { Eyebrow, Panel } from "@/components/ui/Panel";
import { apiOrNull } from "@/lib/api";
import type { BasketSummary, EventView, Headline } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const d = await apiOrNull<{ event: EventView; headlines: Headline[]; baskets: BasketSummary[] }>(`/events/${(await params).id}`);
  if (!d) notFound();
  const t = await getTranslations("event");
  return (
    <main className="space-y-4 pt-6">
      <Eyebrow>{t("eyebrow")}</Eyebrow>
      <EventCard item={{ event: d.event, basket: d.baskets[0] ?? null }} />
      {d.event.reason && <p className="text-sm text-muted">{t("triage", { reason: d.event.reason })}</p>}
      <Panel>
        <Eyebrow tone="muted">{t("headlines", { n: d.headlines.length })}</Eyebrow>
        <ul className="mt-2 space-y-1 text-sm">
          {d.headlines.map((h) => (
            <li key={h.url}>
              <a href={h.url} className="hover:underline" target="_blank" rel="noreferrer">{h.title}</a> <span className="text-xs text-muted">· {h.source}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
