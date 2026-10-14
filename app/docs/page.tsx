import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

export const metadata: Metadata = {
  title: "Docs · Nightshift",
  description: "How the Oracle, Vault, Guardian, formal proofs and Cloak work today, what is a demo, and what comes next.",
};
export default function Page() {
  return <DocsPage />;
}
