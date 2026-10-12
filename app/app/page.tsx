import type { Metadata } from "next";
import { AppPage } from "@/components/Pages";

export const metadata: Metadata = { title: "App · Nightshift", description: "Borrow against tokenized ETFs priced overnight, with Guardian protection." };
export default function Page() {
  return <AppPage />;
}
