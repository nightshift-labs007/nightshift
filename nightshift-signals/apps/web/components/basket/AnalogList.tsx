import { useTranslations } from "next-intl";
import Link from "next/link";
import type { FeedItem } from "@/lib/types";
import { Result } from "@/components/ui/Result";

export function AnalogList({ analogs }: { analogs: FeedItem[] }) {
  const t = useTranslations("basket");
  if (analogs.length === 0) return <p className="text-sm text-muted">{t("noAnalogs")}</p>;
  return (
    <ul className="space-y-2">
      {analogs.map((a) => (
        <li key={a.event.id} className="flex items-center gap-2 text-sm">
          <span className="text-muted num">{a.event.first_seen_at.slice(0, 10)}</span>
          {a.basket ? <Link href={`/b/${a.basket.id}`} className="flex-1 truncate hover:underline">{a.event.title}</Link> : <span className="flex-1 truncate">{a.event.title}</span>}
          {a.basket && <Result vsSpy={a.basket.grade?.vs_spy_pct ?? null} hit={a.basket.grade?.hit ?? null} voidReason={a.basket.void_reason} />}
        </li>
      ))}
    </ul>
  );
}
