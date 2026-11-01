"use client";
import type { BasketLeg } from "@nightshift-signals/core";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { LiveLeg } from "@/lib/types";
import { useChannel } from "@/lib/ws";
import { LegRow } from "./LegRow";

/** Legs with live token prices; snapshot on subscribe, then price ticks and drift alerts over the basket channel. */
export function LiveBasket({ basketId, legs, initial }: { basketId: string; legs: BasketLeg[]; initial: LiveLeg[] }) {
  const t = useTranslations("basket");
  const [live, setLive] = useState(initial);
  useChannel<{ live?: LiveLeg[]; symbol?: string; px?: string; gap_bps?: number }>(`basket:${basketId}`, (m) => {
    if (m.type === "snapshot" && m.data?.live) setLive(m.data.live);
    if (m.type === "delta" && m.event === "price.tick" && m.data?.symbol) {
      const { symbol, px } = m.data;
      setLive((prev) =>
        prev.map((l, i) => (l.token_symbol === symbol && px ? { ...l, mid: px, move_since_entry_pct: (Number(px) / Number(legs[i]!.entry_quote_price) - 1) * 100 } : l)),
      );
    }
    if (m.type === "delta" && m.event === "alert.drift" && m.data?.symbol) {
      setLive((prev) => prev.map((l) => (l.token_symbol === m.data!.symbol ? { ...l, gap_bps: m.data!.gap_bps ?? l.gap_bps } : l)));
    }
  });
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-[11px] text-muted">
          <th className="pb-1 font-normal">{t("leg")}</th>
          <th className="pb-1 text-right font-normal">{t("token")}</th>
          <th className="pb-1 text-right font-normal">{t("fairValue")}</th>
          <th className="pb-1 text-right font-normal">{t("sinceEntry")}</th>
        </tr>
      </thead>
      <tbody>
        {legs.map((leg) => (
          <LegRow key={leg.token_symbol} leg={leg} live={live.find((l) => l.token_symbol === leg.token_symbol)} />
        ))}
      </tbody>
    </table>
  );
}
