import type { Metadata } from "next";
import { TransparencyPage } from "@/components/Pages";

export const metadata: Metadata = { title: "Transparency · Nightshift", description: "Predictions recorded on Base, on-chain activity, machine-checked safety proofs and public contract addresses." };
export default function Page() {
  return <TransparencyPage />;
}
