import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StockPage } from "@/components/StockPage";
import { STOCKS } from "@/lib/stocks";

export function generateStaticParams() {
  return STOCKS.map((s) => ({ ticker: s.ticker }));
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const def = STOCKS.find((s) => s.ticker === ticker.toUpperCase());
  if (!def) return { title: "Not found · Nightshift" };
  return { title: `${def.ticker} · ${def.name} · Nightshift`, description: `${def.name} (${def.ticker}): live price, Nightshift's after-hours fair value and confidence, and every recent open call graded.` };
}

export default async function Page({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const def = STOCKS.find((s) => s.ticker === ticker.toUpperCase());
  if (!def) notFound();
  return <StockPage ticker={def.ticker} />;
}
