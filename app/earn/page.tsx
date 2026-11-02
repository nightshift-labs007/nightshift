import type { Metadata } from "next";
import { Earn } from "@/components/Earn";
import { PageHero, PageShell } from "@/components/Site";

export const metadata: Metadata = { title: "Earn · Nightshift", description: "A live, read-only view of Sentora's PYUSD yield vault on Ethereum." };
export default function Page() {
  return (
    <PageShell>
      <PageHero
        overline="EARN · SENTORA"
        title="Idle stablecoins could earn a protected RWA rate."
        lead="A live, read-only view of Sentora's PYUSD vault on Ethereum: current yield, size and history. Deposits happen on Sentora; Nightshift never touches your funds."
      />
      <section className="block" id="earn">
        <div className="wrap">
          <Earn />
        </div>
      </section>
    </PageShell>
  );
}
