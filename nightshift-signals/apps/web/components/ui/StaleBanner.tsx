"use client";
import { useTranslations } from "next-intl";
import { useStale } from "@/lib/ws";

/** Shown when the live connection has been down for more than 15 seconds: the page is no longer live. */
export function StaleBanner() {
  const stale = useStale();
  const t = useTranslations("feed");
  if (!stale) return null;
  return (
    <div role="status" className="my-3 rounded-lg border border-hot/40 bg-hot/10 px-3 py-2 text-sm">
      {t("stale")}
    </div>
  );
}
