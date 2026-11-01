import type { Metadata } from "next";
import { Scorecard } from "@/components/Scorecard";
import { PageHero, PageShell } from "@/components/Site";

export const metadata: Metadata = {
  title: "Monday scorecard · Nightshift",
  description: "How close Nightshift's overnight price came to the real open each week, misses included.",
};

export default function Page() {
  return (
    <PageShell>
      <PageHero
        overline="SCORECARD · WEEKLY"
        title="How close were we to the open?"
        lead="Every week: Nightshift's overnight price against the real 09:30 ET open and against a frozen feed, for every token. Wins and misses, both shown."
      />
      <Scorecard />
    </PageShell>
  );
}
