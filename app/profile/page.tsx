import type { Metadata } from "next";
import { ProfilePage } from "@/components/ProfilePage";

export const metadata: Metadata = { title: "Profile · Nightshift", description: "Build your Nightshift profile and see the points you've collected." };
export default function Page() {
  return <ProfilePage />;
}
