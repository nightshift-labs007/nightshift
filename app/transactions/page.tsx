import type { Metadata } from "next";
import { TransactionsPage } from "@/components/Transactions";

export const metadata: Metadata = { title: "Transactions · Nightshift", description: "Every transaction on Nightshift in one place: loans, Guardian saves, Oracle updates and the public record on Base." };
export default function Page() {
  return <TransactionsPage />;
}
