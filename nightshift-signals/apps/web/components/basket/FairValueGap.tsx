import { useTranslations } from "next-intl";
import { bps } from "@/lib/format";

/** Token price vs off-hours fair value, side by side. Frozen when the proxy market is closed. */
export function FairValueGap({ gap, frozen }: { gap: number | null; frozen: boolean }) {
  const t = useTranslations("basket");
  if (gap === null) return <span className="text-xs text-muted">{t("noFv")}</span>;
  return (
    <span className="num text-xs">
      <span className={Math.abs(gap) > 150 ? "text-hot" : "text-muted"}>
        {bps(gap)} {gap > 0 ? t("rich") : gap < 0 ? t("cheap") : ""}
      </span>
      {frozen && <span className="ml-1 rounded bg-panel-2 px-1 text-[10px] text-muted">{t("frozen")}</span>}
    </span>
  );
}
