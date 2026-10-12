"use client";

import { useEffect, useState } from "react";

type Tone = "ok" | "warn" | "error" | "info";
type Item = { id: number; msg: string; tone: Tone };

let seq = 0;
const subs = new Set<(t: Item) => void>();

/** Fire-and-forget toast from anywhere in the client tree. */
export function toast(msg: string, tone: Tone = "info") {
  const item = { id: ++seq, msg, tone };
  subs.forEach((s) => s(item));
}

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const on = (t: Item) => {
      setItems((xs) => [...xs.slice(-3), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === "error" || t.tone === "warn" ? 6500 : 4200);
    };
    subs.add(on);
    return () => {
      subs.delete(on);
    };
  }, []);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <i />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
