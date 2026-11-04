import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EtfPage } from "@/components/EtfPage";
import { PAIRS } from "@/lib/config";

export function generateStaticParams() {
  return PAIRS.map((p) => ({ token: p.token }));
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const pair = PAIRS.find((p) => p.token === token.toUpperCase());
  if (!pair) return { title: "Not found · Nightshift" };
  return { title: `${pair.token} · ${pair.name} · Nightshift`, description: `Live ${pair.name} (${pair.token}) price, Nightshift's fair value and confidence while Wall Street is closed, and every past call graded against the real open.` };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pair = PAIRS.find((p) => p.token === token.toUpperCase());
  if (!pair) notFound();
  return <EtfPage token={pair.token} name={pair.name} anchorName={pair.anchorName} />;
}
