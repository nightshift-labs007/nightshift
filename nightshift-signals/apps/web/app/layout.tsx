import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { IBM_Plex_Sans, JetBrains_Mono, Noto_Sans_Devanagari, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { LanguagePicker } from "@/components/ui/LanguagePicker";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "500", "600"], variable: "--font-devanagari", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Nightshift Signals", template: "%s · Nightshift Signals" },
  description: "Every headline becomes an ETF trade in 60 seconds, graded in public at the market open.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = { themeColor: "#0d111a", width: "device-width", initialScale: 1 };

// Sets the theme before paint so there is no flash.
const themeScript = `try{var t=localStorage.getItem("fp.theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations();
  const nav = [
    ["/", t("nav.feed")],
    ["/scorecard", t("nav.scorecard")],
    ["/league", t("nav.league")],
    ["/replay", t("nav.replay")],
    ["/brief", t("nav.brief")],
    ["/radar", t("nav.radar")],
    ["/me", t("nav.alerts")],
  ] as const;
  return (
    <html lang={locale} className={`${display.variable} ${sans.variable} ${mono.variable} ${devanagari.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
            <nav className="mx-auto flex max-w-3xl items-center gap-x-4 gap-y-1 overflow-x-auto px-4 py-3 text-sm whitespace-nowrap">
              <Link href="/" className="font-display text-lg font-semibold tracking-tight">
                Flash<span className="text-hot">point</span>
              </Link>
              {nav.map(([href, label]) => (
                <Link key={href} href={href} className="text-muted hover:text-paper">{label}</Link>
              ))}
              <span className="ml-auto flex items-center gap-2">
                <LanguagePicker />
                <ThemeToggle />
              </span>
            </nav>
          </header>
          <div className="mx-auto max-w-3xl px-4 pb-16">{children}</div>
          <footer className="mx-auto max-w-3xl border-t border-line px-4 py-6 text-xs text-muted">{t("footer")}</footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
