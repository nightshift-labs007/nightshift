"use client";

import { useEffect, useState } from "react";

export function useApi<T>(url: string, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const load = async () => {
      if (retry) clearTimeout(retry);
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (alive) {
          failures = 0;
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!alive) return;
        setError(String(e));
        // a failed load retries soon (5 s, 15 s, 45 s, then every 2 min) instead of waiting for the next refresh,
        // so one slow or failed first request doesn't leave a section on "Loading…"
        failures++;
        retry = setTimeout(load, Math.min(5000 * 3 ** (failures - 1), 120_000));
      }
    };
    load();
    const id = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
      if (retry) clearTimeout(retry);
    };
  }, [url, refreshMs]);

  return { data, error };
}

export const usd = (x: number, d = 2) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });

export const signed = (x: number, d = 2, suffix = "%") => `${x >= 0 ? "+" : ""}${x.toFixed(d)}${suffix}`;
