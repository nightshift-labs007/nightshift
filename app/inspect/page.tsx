import type { Metadata } from "next";
import { InspectReport } from "@/components/InspectReport";

export const metadata: Metadata = {
  title: "Engine inspection · Nightshift",
  description: "What the Nightshift engine is doing right now, and its live overnight read on the world's largest stocks.",
};

export default function InspectPage() {
  return <InspectReport />;
}
