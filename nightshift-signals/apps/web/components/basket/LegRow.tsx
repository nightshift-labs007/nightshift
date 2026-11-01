import type { BasketLeg } from "@nightshift-signals/core";
import { useTranslations } from "next-intl";
import { pctPoints, price, weight } from "@/lib/format";
import type { LiveLeg } from "@/lib/types";
import { FairValueGap } from "./FairValueGap";

export function LegRow({ leg, live }: { leg: BasketLeg; live: LiveLeg | undefined }) {
  const t = useTranslations("basket");
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-2">
        <p className="font-mono text-sm font-medium">{leg.underlying_ticker}</p>
        <p className="text-[11px] text-muted">{weight(leg.weight)}</p>
      </td>
      <td className="num py-2 pr-2 text-right text-sm">
        {price(live?.mid ?? null)}
        <p className="text-[11px] text-muted">{t("entry", { px: price(leg.entry_quote_price) })}</p>
      </td>
      <td className="num py-2 pr-2 text-right text-sm">
        {price(live?.fair_value ?? null)}
        <p>
          <FairValueGap gap={live?.gap_bps ?? null} frozen={live?.frozen ?? false} />
        </p>
      </td>
      <td className="num py-2 text-right text-sm">{pctPoints(live?.move_since_entry_pct ?? null)}</td>
    </tr>
  );
}
