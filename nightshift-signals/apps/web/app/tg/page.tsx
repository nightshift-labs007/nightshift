"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useRef } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
}

/**
 * Telegram Mini App entry. Signs the user in with Telegram's signed init data (verified server-side),
 * follows the theme, and opens the basket named in the start parameter. The rest is the normal web app.
 */
export default function TelegramEntry() {
  const t = useTranslations("tg");
  const router = useRouter();
  const session = useSession();
  const started = useRef(false);

  async function start() {
    if (started.current) return;
    started.current = true;
    const wa = (window as unknown as { Telegram?: { WebApp: TelegramWebApp } }).Telegram?.WebApp;
    if (!wa?.initData) return router.replace("/");
    wa.ready();
    wa.expand();
    document.documentElement.dataset.theme = wa.colorScheme;
    try {
      const r = await api<{ token: string; start_param: string | null }>("/auth/telegram", { method: "POST", body: JSON.stringify({ init_data: wa.initData }) });
      session.signIn(r.token);
    } catch {
      /* browsing works signed out */
    }
    const param = wa.initDataUnsafe.start_param;
    router.replace(param && /^bkt_[a-z0-9_]+$/.test(param) ? `/b/${param}` : "/");
  }

  return (
    <main className="pt-16 text-center text-sm text-muted">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => void start()} />
      {t("opening")}
    </main>
  );
}
