import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCategory } from "@/components/ui/CategoryLabel";
import { Result } from "@/components/ui/Result";
import { pct } from "@/lib/format";
import type { ScorecardRow } from "@/lib/types";

/** Every basket, misses and voids included, newest first. Also the table view of the charts above. */
export function BasketTable({ rows }: { rows: ScorecardRow[] }) {
  const t = useTranslations("scorecard");
  const tf = useTranslations("feed");
  const category = useCategory();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="pb-2 font-normal">{t("published")}</th>
            <th className="pb-2 font-normal">{t("basket")}</th>
            <th className="pb-2 text-right font-normal">{t("return")}</th>
            <th className="pb-2 text-right font-normal">{t("vsSpy")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.basket_id} className="border-t border-line align-top">
              <td className="num py-2 pr-2 text-xs whitespace-nowrap text-muted">{r.published_at.slice(0, 10)}</td>
              <td className="py-2 pr-2">
                <Link href={`/b/${r.basket_id}`} className="line-clamp-2 hover:underline">{r.thesis}</Link>
                <p className="text-[11px] text-muted">
                  {category(r.category)} · {tf("conf", { n: Math.round(r.confidence * 100) })}
                </p>
              </td>
              <td className="num py-2 pr-2 text-right">{pct(r.ret_pct)}</td>
              <td className="py-2 text-right">
                <Result vsSpy={r.vs_spy_pct} hit={r.hit} voidReason={r.void_reason} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
