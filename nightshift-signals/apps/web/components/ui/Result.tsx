import { useTranslations } from "next-intl";
import { pct } from "@/lib/format";

/** Win or miss with sign and word; color only reinforces. */
export function Result({ vsSpy, hit, voidReason }: { vsSpy: string | null; hit: boolean | null; voidReason?: string | null }) {
  const t = useTranslations("result");
  if (voidReason) return <span className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-muted">{t("void")} · {voidReason.replace(/_/g, " ")}</span>;
  if (hit === null || vsSpy === null) return <span className="text-xs text-muted">{t("pending")}</span>;
  return (
    <span className={`num rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${hit ? "bg-beat/20" : "bg-miss/20"}`}>
      {hit ? `▲ ${t("beat")}` : `▼ ${t("missed")}`} {pct(vsSpy)}
    </span>
  );
}
