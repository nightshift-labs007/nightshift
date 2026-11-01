import { tradeLinksAllowed } from "@nightshift-signals/core/links";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalogList } from "@/components/basket/AnalogList";
import { FollowOrFade } from "@/components/basket/FollowOrFade";
import { LiveBasket } from "@/components/basket/LiveBasket";
import { ProofLink } from "@/components/basket/ProofLink";
import { TradeButtons } from "@/components/basket/TradeButtons";
import { WhyGraph } from "@/components/basket/WhyGraph";
import { SeverityChip } from "@/components/feed/SeverityChip";
import { Eyebrow, Panel } from "@/components/ui/Panel";
import { Result } from "@/components/ui/Result";
import { StaleBanner } from "@/components/ui/StaleBanner";
import { apiOrNull } from "@/lib/api";
import { etTime, pct, price } from "@/lib/format";
import type { BasketDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const d = await apiOrNull<BasketDetail>(`/baskets/${(await params).id}`);
  return d ? { title: d.event?.title ?? "Basket", description: d.basket.thesis } : { title: "Basket not found" };
}

export default async function BasketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await apiOrNull<BasketDetail>(`/baskets/${id}`);
  if (!d) notFound();
  const [t, tc, ts, tf, locale] = [
    await getTranslations("basket"),
    await getTranslations("categories"),
    await getTranslations("status"),
    await getTranslations("feed"),
    await getLocale(),
  ];
  const h = await headers();
  const country = h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry");
  const tradeAllowed = tradeLinksAllowed(country, { allowUnknown: process.env.NODE_ENV !== "production" || process.env.NIGHTSHIFT_SIGNALS_MODE === "local" });
  const { basket: b, event: e, grade: g } = d;
  const translated = b.thesis_i18n[locale];

  return (
    <main className="min-w-0 space-y-4 pt-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>{t("eyebrow", { status: ts(b.status) })}</Eyebrow>
          {e && <SeverityChip severity={e.severity} corroborated={e.corroborated} />}
          {e && <span className="text-xs text-muted">{tc(e.category ?? "none")}</span>}
          {d.commit?.simulated && <span className="rounded bg-cool/15 px-1.5 py-0.5 text-[11px] text-cool">{tf("simulated")}</span>}
        </div>
        <h1 className="mt-2 font-display text-2xl leading-tight font-semibold">{e?.title}</h1>
        <p className="mt-3 text-lg">{translated ?? b.thesis}</p>
        {translated && <p className="mt-1 text-xs text-muted">{t("translated")} “{b.thesis}”</p>}
        <p className="num mt-2 text-xs text-muted">
          {t("published", { time: b.published_at ? etTime(b.published_at) : "—", conf: Math.round(b.confidence * 100) })}
          {b.confidence_calibrated !== null && ` ${t("calibrated", { n: Math.round(b.confidence_calibrated * 100) })}`} · {b.horizon.replace("_", " ")} · {b.model_version}
        </p>
      </div>
      <StaleBanner />

      {b.why_chain.length >= 2 && (
        <Panel>
          <WhyGraph steps={d.why_chain_i18n[locale] ?? b.why_chain} label={t("why")} />
        </Panel>
      )}

      {g && (
        <Panel accent="cool">
          <div className="flex items-center justify-between">
            <Eyebrow tone="cool">{t("graded", { time: etTime(g.graded_at) })}</Eyebrow>
            <Result vsSpy={g.vs_spy_pct} hit={g.hit} />
          </div>
          <p className="num mt-2 text-sm">
            {t("gradeLine", { ret: pct(g.ret_pct), spy: `${pct(g.spy_ret_pct)} (${price(g.spy_entry)} → ${price(g.spy_exit)})` })}
          </p>
        </Panel>
      )}
      {b.status === "void" && (
        <Panel>
          <p className="text-sm">{t("void", { reason: b.void_reason?.replace(/_/g, " ") ?? "" })}</p>
        </Panel>
      )}

      <Panel accent="hot">
        <LiveBasket basketId={b.id} legs={b.legs} initial={d.live} />
      </Panel>

      <Panel>
        <FollowOrFade basketId={b.id} />
      </Panel>

      <Panel>
        <Eyebrow tone="muted">{t("trade")}</Eyebrow>
        <div className="mt-3">
          <TradeButtons basketId={b.id} tradeAllowed={tradeAllowed} open={b.status === "published"} />
        </div>
      </Panel>

      <ProofLink basketId={b.id} commit={d.commit} />

      <Panel>
        <Eyebrow tone="muted">{t("sources")}</Eyebrow>
        <ul className="mt-2 space-y-1 text-sm">
          {d.headlines.map((h) => (
            <li key={h.url}>
              <a href={h.url} className="hover:underline" target="_blank" rel="noreferrer">{h.title}</a> <span className="text-xs text-muted">· {h.source}</span>
            </li>
          ))}
        </ul>
        {e && <Link href={`/e/${e.id}`} className="mt-2 inline-block text-xs text-cool underline">{t("allBaskets")}</Link>}
      </Panel>

      <Panel>
        <Eyebrow tone="cool">{t("analogs")}</Eyebrow>
        <div className="mt-2">
          <AnalogList analogs={d.analogs} />
        </div>
      </Panel>
    </main>
  );
}
