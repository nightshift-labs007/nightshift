"use client";
import { LOCALES } from "@nightshift-signals/core/enums";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export function LanguagePicker() {
  const locale = useLocale();
  const t = useTranslations();
  const router = useRouter();
  return (
    <select
      aria-label={t("nav.language")}
      value={locale}
      onChange={(e) => {
        document.cookie = `fp.lang=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      className="rounded-md border border-line bg-panel px-1.5 py-1 text-xs text-muted"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>{t(`language.${l}`)}</option>
      ))}
    </select>
  );
}
