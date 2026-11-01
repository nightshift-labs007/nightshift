import type { Metadata } from "next";
import { HindiPage } from "@/components/HindiPage";

export const metadata: Metadata = {
  title: "Nightshift हिंदी में",
  description: "टोकनाइज़्ड ETF की रात भर की उचित कीमत, लोन सुरक्षा और ज़ीरो-नॉलेज प्रूफ़: Nightshift हिंदी में।",
};

export default function Page() {
  return <HindiPage />;
}
