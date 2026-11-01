"use client";
import { useTranslations } from "next-intl";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="pt-10">
      <div className="rounded-xl border border-hot/40 bg-hot/10 p-6 text-sm">
        <p>{t("api")}</p>
        <button onClick={reset} className="mt-3 rounded-md bg-hot px-3 py-1 text-xs font-medium text-ink">{t("retry")}</button>
      </div>
    </main>
  );
}
