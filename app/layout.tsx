import type { Metadata, Viewport } from "next";
import { Funnel_Sans, Geist_Mono, Unbounded } from "next/font/google";
import "./globals.css";
import "./theme.css";
import { WalletProvider } from "@/lib/wallet";
import { AlwaysOnAudio } from "@/components/AlwaysOnAudio";

const display = Unbounded({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Nightshift — Tokenized ETFs, priced after the bell",
  description:
    "Off-hours price oracle, lending vault, loan guardian and zero-knowledge solvency proofs for tokenized ETFs on Robinhood Chain.",
};

export const viewport: Viewport = {
  themeColor: "#070909",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <AlwaysOnAudio />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
