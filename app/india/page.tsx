import type { Metadata } from "next";
import { IndiaDesk } from "@/components/IndiaDesk";
import { PageHero, PageShell } from "@/components/Site";

export const metadata: Metadata = {
  title: "India research desk · Nightshift",
  description: "A pre-open estimate for the Nifty 50, five years of backtested overnight conditions, and a geopolitical and political news radar. Research, not advice.",
};

export default function Page() {
  return (
    <PageShell>
      <PageHero
        overline="INDIA · RESEARCH DESK"
        title="Before the Nifty opens, know what usually happens next."
        lead="A pre-open estimate graded against every open, five years of backtests on what overnight events did to the Nifty, and a radar of the geopolitical and political news that moves it. Research and history, not tips."
      />
      <IndiaDesk />
    </PageShell>
  );
}
