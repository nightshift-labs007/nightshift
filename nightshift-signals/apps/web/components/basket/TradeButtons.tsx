"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { price } from "@/lib/format";
import { fetchLinks, logEntry } from "@/lib/links";
import { useSession } from "@/lib/session";
import type { QuoteLeg } from "@/lib/types";
import { SizeSlider } from "./SizeSlider";
import { SlippageBadge } from "./SlippageBadge";

/** Size → live quote (re-quoted every 10 s) → one button per leg into the user's own wallet. Non-custodial. */
export function TradeButtons({ basketId, tradeAllowed, open }: { basketId: string; tradeAllowed: boolean; open: boolean }) {
  const t = useTranslations("trade");
  const [usdg, setUsdg] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const session = useSession();
  const quote = useQuery({
    queryKey: ["quote", basketId, usdg],
    queryFn: () => api<{ legs: QuoteLeg[]; max_slip_bps: number }>(`/baskets/${basketId}/quote?usdg=${usdg}`),
    refetchInterval: 10_000,
    enabled: tradeAllowed && open,
  });

  if (!tradeAllowed) {
    return <p className="rounded-lg border border-line p-3 text-sm text-muted">{t("region")}</p>;
  }
  if (!open) return <p className="rounded-lg border border-line p-3 text-sm text-muted">{t("closed")}</p>;

  async function trade(leg: QuoteLeg) {
    setError(null);
    try {
      const { links, simulated } = await fetchLinks(basketId, usdg);
      const link = links.find((l) => l.token_symbol === leg.token_symbol);
      if (session.token && leg.price) await logEntry(session.token, basketId, usdg, [{ token_symbol: leg.token_symbol, price: leg.price, usdg: leg.usdg }]);
      if (simulated || !link?.url) {
        setError(t("simulated"));
        return;
      }
      window.open(link.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 451 ? t("region") : String((e as Error).message));
    }
  }

  return (
    <div className="space-y-3">
      <SizeSlider value={usdg} onChange={setUsdg} />
      <div className="space-y-2">
        {(quote.data?.legs ?? []).map((l) => (
          <div key={l.token_symbol} className={`flex items-center gap-2 rounded-lg border border-line p-2 ${l.over_cap ? "opacity-50" : ""}`}>
            <span className="font-mono text-sm">{l.underlying_ticker}</span>
            <span className="num text-xs text-muted">
              {l.usdg} USDG @ {price(l.price)}
            </span>
            <SlippageBadge bps={l.slippage_bps} cap={quote.data!.max_slip_bps} />
            <button
              type="button"
              disabled={l.over_cap}
              onClick={() => void trade(l)}
              className="ml-auto rounded-md bg-hot px-3 py-1 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted"
            >
              {l.over_cap ? t("tooThin") : t("buy", { ticker: l.underlying_ticker })}
            </button>
          </div>
        ))}
        {quote.isLoading && <div className="h-24 animate-pulse rounded-lg bg-panel-2" />}
      </div>
      {error && <p role="alert" className="text-xs text-hot">{error}</p>}
      <p className="text-[11px] text-muted">{t("note")}</p>
    </div>
  );
}
