"use client";
import { useTranslations } from "next-intl";

export function ThemeToggle() {
  const t = useTranslations("nav");
  return (
    <button
      type="button"
      aria-label={t("theme")}
      className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-paper"
      onClick={() => {
        const el = document.documentElement;
        const next = el.dataset.theme === "light" ? "dark" : "light";
        el.dataset.theme = next;
        try {
          localStorage.setItem("fp.theme", next);
        } catch {
          /* storage unavailable */
        }
      }}
    >
      {t("theme")}
    </button>
  );
}
