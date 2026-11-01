"use client";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import type { BasketSummary, EventView, FeedItem } from "@/lib/types";
import { useChannel } from "@/lib/ws";
import { Empty } from "@/components/ui/Panel";
import { EventCard } from "./EventCard";

export interface FeedFilter {
  severity: number;
  sector?: string;
  region?: string;
}

const matches = (e: EventView, f: FeedFilter) =>
  (e.severity ?? 0) >= f.severity && (!f.sector || e.category === f.sector) && (!f.region || e.regions.some((r) => r.toLowerCase() === f.region!.toLowerCase()));

export function LiveFeed({ initial, filter, query }: { initial: FeedItem[]; filter: FeedFilter; query: string }) {
  const t = useTranslations("feed");
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const refetch = useCallback(() => void api<{ items: FeedItem[] }>(`/feed?${query}`).then((r) => setItems(r.items)), [query]);

  useChannel<{ event: EventView; basket?: BasketSummary }>(
    "feed",
    (m) => {
      if (m.type !== "delta" || !m.data || !matches(m.data.event, filter)) return;
      const { event, basket } = m.data;
      setItems((prev) => {
        const existing = prev.find((x) => x.event.id === event.id);
        const next = { event, basket: basket ?? existing?.basket ?? null };
        return [next, ...prev.filter((x) => x.event.id !== event.id)].slice(0, 100);
      });
      setFresh((s) => new Set(s).add(event.id));
    },
    { onGap: refetch },
  );

  if (items.length === 0) return <Empty>{t("quiet")}</Empty>;
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <EventCard key={it.event.id} item={it} fresh={fresh.has(it.event.id)} />
      ))}
    </div>
  );
}
