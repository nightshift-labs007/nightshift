import type { Metadata } from "next";
import { TransparencyPage } from "@/components/Pages";

export const metadata: Metadata = { title: "Transparency · Nightshift", description: "Algorand-stamped predictions, machine-checked safety proofs and public contract addresses." };
export default function Page() {
  return <TransparencyPage />;
}
