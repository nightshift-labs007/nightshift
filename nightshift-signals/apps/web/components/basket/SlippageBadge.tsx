import { useTranslations } from "next-intl";

export function SlippageBadge({ bps, cap }: { bps: number | null; cap: number }) {
  const t = useTranslations("trade");
  if (bps === null) return <span className="text-xs text-muted">{t("noQuote")}</span>;
  const over = bps > cap;
  return (
    <span className={`num rounded px-1.5 py-0.5 text-[11px] ${over ? "bg-miss/20" : "bg-panel-2 text-muted"}`}>
      {over ? "⚠ " : ""}
      {t("slip", { n: bps })}
      {over ? ` (${t("over", { n: cap })})` : ""}
    </span>
  );
}
