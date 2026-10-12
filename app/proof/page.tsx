import type { Metadata } from "next";
import { ProofPage } from "@/components/Pages";

export const metadata: Metadata = { title: "Proof · Nightshift", description: "Prove a loan is solvent with a zero-knowledge proof, or verify one someone shared." };
export default function Page() {
  return <ProofPage />;
}
