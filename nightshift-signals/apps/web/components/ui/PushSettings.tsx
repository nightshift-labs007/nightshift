"use client";
import { useTranslations, useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Lock-screen alerts via Web Push. Preferences choose which alerts arrive, never how early. */
export function PushSettings({ token }: { token: string | null }) {
  const t = useTranslations("push");
  const locale = useLocale();
  const [state, setState] = useState<"loading" | "unsupported" | "denied" | "off" | "on" | "unconfigured">("loading");
  const [prefs, setPrefs] = useState({ min_severity: 3, drift: false, receipts: true, quiet: false, quiet_start: 23, quiet_end: 7 });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      // The service worker exists only for push, so it is registered here rather than on every page.
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  async function subscribe() {
    setSaved(false);
    try {
      const { key } = await api<{ key: string }>("/push/key");
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
      await api("/push/subscribe", {
        method: "POST",
        token,
        body: JSON.stringify({
          subscription: sub.toJSON(),
          min_severity: prefs.min_severity,
          drift: prefs.drift,
          receipts: prefs.receipts,
          quiet_start: prefs.quiet ? prefs.quiet_start : null,
          quiet_end: prefs.quiet ? prefs.quiet_end : null,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          lang: locale,
        }),
      });
      setState("on");
      setSaved(true);
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "unconfigured" : "off");
    }
  }

  async function unsubscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "loading") return null;
  if (state === "unsupported") return <p className="text-sm text-muted">{t("unsupported")}</p>;
  if (state === "denied") return <p className="text-sm text-muted">{t("denied")}</p>;
  if (state === "unconfigured") return <p className="text-sm text-muted">{t("notConfigured")}</p>;

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const sel = "rounded-md border border-line bg-panel-2 px-2 py-1 text-xs";
  return (
    <div className="space-y-3 text-sm">
      {state === "on" && <p className="text-cool">{t("on")}</p>}
      <label className="flex items-center gap-2">
        {t("minSeverity")}
        <select className={sel} value={prefs.min_severity} onChange={(e) => setPrefs({ ...prefs, min_severity: Number(e.target.value) })}>
          {[2, 3, 4, 5].map((s) => (
            <option key={s} value={s}>{s}+</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={prefs.receipts} onChange={(e) => setPrefs({ ...prefs, receipts: e.target.checked })} /> {t("receipts")}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={prefs.drift} onChange={(e) => setPrefs({ ...prefs, drift: e.target.checked })} /> {t("drift")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prefs.quiet} onChange={(e) => setPrefs({ ...prefs, quiet: e.target.checked })} /> {t("quiet")}
        </label>
        {prefs.quiet && (
          <>
            {t("from")}
            <select className={sel} value={prefs.quiet_start} onChange={(e) => setPrefs({ ...prefs, quiet_start: Number(e.target.value) })}>
              {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
            {t("to")}
            <select className={sel} value={prefs.quiet_end} onChange={(e) => setPrefs({ ...prefs, quiet_end: Number(e.target.value) })}>
              {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={() => void subscribe()} className="rounded-md bg-hot px-3 py-1.5 text-xs font-medium text-ink">
          {state === "on" ? t("save") : t("enable")}
        </button>
        {state === "on" && <button onClick={() => void unsubscribe()} className="text-xs text-muted underline">{t("disable")}</button>}
        {saved && <span className="text-xs text-muted">✓</span>}
      </div>
    </div>
  );
}
