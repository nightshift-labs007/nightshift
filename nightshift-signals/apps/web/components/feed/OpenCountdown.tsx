"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * Time until the 9:30 ET open: the moment every basket is judged against. The server passes the
 * schedule so the market calendar stays out of the browser bundle.
 */
export function OpenCountdown({ nextOpen, openUntil }: { nextOpen: string; openUntil: string | null }) {
  const t = useTranslations("feed");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <span className="font-mono text-xs text-muted">&nbsp;</span>;
  if (openUntil && now < new Date(openUntil).getTime()) return <span className="font-mono text-xs text-cool">{t("marketOpen")}</span>;
  const mins = Math.max(0, Math.round((new Date(nextOpen).getTime() - now) / 60_000));
  const h = Math.floor(mins / 60);
  return <span className="num font-mono text-xs text-hot">{t("openIn", { time: `${h > 0 ? `${h}h ` : ""}${mins % 60}m` })}</span>;
}
