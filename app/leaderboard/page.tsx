import type { Metadata } from "next";
import { LeaderboardPage } from "@/components/Leaderboard";

export const metadata: Metadata = { title: "Leaderboard · Nightshift", description: "Every wallet that joined or used Nightshift, ranked on public chains." };
export default function Page() {
  return <LeaderboardPage />;
}
