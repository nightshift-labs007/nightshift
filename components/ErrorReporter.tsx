"use client";

import { useEffect } from "react";

/**
 * Sends uncaught browser errors to /api/ops/error (at most 5 per page view, page path without query string). The
 * server scrubs and keeps the last 50; the team reads them at /api/ops/errors. No third-party service, no cookies read.
 */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const send = (msg: string) => {
      if (!msg || sent >= 5) return;
      sent++;
      const body = JSON.stringify({ msg: msg.slice(0, 500), where: window.location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/ops/error", new Blob([body], { type: "application/json" }));
      else fetch("/api/ops/error", { method: "POST", body, keepalive: true }).catch(() => {});
    };
    const onError = (e: ErrorEvent) => send(`${e.message} @ ${(e.filename ?? "").replace(/[?#].*$/, "").split("/").pop()}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) => send(`unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
