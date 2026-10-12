"use client";

import { useEffect, useState } from "react";

export function useApi<T>(url: string, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    load();
    const id = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
  }, [url, refreshMs]);

  return { data, error };
}

export const usd = (x: number, d = 2) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });

export const signed = (x: number, d = 2, suffix = "%") => `${x >= 0 ? "+" : ""}${x.toFixed(d)}${suffix}`;
