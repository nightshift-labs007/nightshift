import type { Metadata } from "next";
import { OraclePage } from "@/components/Pages";

export const metadata: Metadata = { title: "Oracle · Nightshift", description: "Live off-hours fair values, confidence, signal breakdown, shift report and public API." };
export default function Page() {
  return <OraclePage />;
}
