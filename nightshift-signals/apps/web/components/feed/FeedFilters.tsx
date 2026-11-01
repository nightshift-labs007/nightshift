import { CATEGORIES } from "@nightshift-signals/core/enums";
import { useTranslations } from "next-intl";
import { useCategory } from "@/components/ui/CategoryLabel";

export function FeedFilters({ severity, sector, region }: { severity: number; sector?: string; region?: string }) {
  const t = useTranslations("feed");
  const category = useCategory();
  const cls = "rounded-md border border-line bg-panel px-2 py-1 text-xs";
  return (
    <form className="flex flex-wrap items-center gap-2" action="/">
      <select aria-label={t("severity", { n: "" })} name="severity" defaultValue={String(severity)} className={cls}>
        {[0, 1, 2, 3, 4, 5].map((s) => (
          <option key={s} value={s}>{t("severity", { n: s })}</option>
        ))}
      </select>
      <select aria-label={t("allSectors")} name="sector" defaultValue={sector ?? ""} className={cls}>
        <option value="">{t("allSectors")}</option>
        {CATEGORIES.filter((c) => c !== "other").map((c) => (
          <option key={c} value={c}>{category(c)}</option>
        ))}
      </select>
      <input aria-label={t("region")} name="region" placeholder={t("region")} defaultValue={region ?? ""} className={`${cls} w-24`} />
      <button className="rounded-md bg-hot px-2.5 py-1 text-xs font-medium text-ink">{t("filter")}</button>
    </form>
  );
}
