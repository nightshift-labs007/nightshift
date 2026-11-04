import type { Metadata } from "next";
import { ProfilePage } from "@/components/ProfilePage";

export const metadata: Metadata = { title: "Profile · Nightshift", description: "Sign up for Nightshift and edit your profile." };
export default function Page() {
  return <ProfilePage />;
}
