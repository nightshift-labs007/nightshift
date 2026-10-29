"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isMainnet } from "@/lib/chain";
import { BrandMark } from "./BrandMark";
import { ExplorePanel } from "./ExplorePanel";
import { JoinPrompt } from "./Leaderboard";
import { Toaster } from "./Toast";
import { WelcomeGuide } from "./WelcomeGuide";
import { WalletButton } from "./WalletButton";
import { ProfileAvatar } from "./ProfileAvatar";
import { useWallet } from "@/lib/wallet";

/** Your profile, from every page: your photo (or badge) when a wallet is connected, a person icon otherwise. */
function ProfileButton() {
  const w = useWallet();
  return (
    <Link className={`nav-profile ${w.account ? "on" : ""}`} href="/profile" aria-label="Your profile" title="Your profile">
      {w.account ? (
        <ProfileAvatar address={w.account} size={36} />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6" />
        </svg>
      )}
    </Link>
  );
}

export function SiteNav() {
  const path = usePathname();
  const [menu, setMenu] = useState(false); // the Explore panel
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <nav className={`nav ${scrolled ? "scrolled" : ""}`} aria-label="Main">
      <div className="wrap nav-inner">
        {/* every page lives in the left-hand menu (ExplorePanel), so the top bar stays clean */}
        <button className="xp-btn" onClick={() => setMenu(true)} aria-expanded={menu} aria-haspopup="dialog" aria-label="Menu: all pages and integrations" title="All pages and integrations">
          <span className="xp-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="xp-btn-label">Menu</span>
        </button>
        <Link className="brand" href="/">
          <BrandMark /> Nightshift
        </Link>
        <WalletButton />
        {path !== "/app" && (
          <Link className="btn primary small nav-cta" href="/app">
            Launch app
          </Link>
        )}
        <ProfileButton />
      </div>
      <ExplorePanel open={menu} setOpen={setMenu} />
    </nav>
  );
}

export function SiteFooter() {
  return (
    <>
      <footer className="footer">
        <div className="wrap footer-inner">
          <Link className="brand" href="/">
            <BrandMark /> Nightshift
          </Link>
          <p>
            {isMainnet ? "Unaudited demonstration: the Vault on Base uses demo assets with no value; never send real tokens to it." : "Concept demonstration on test networks: no real funds."} Oracle values are data, not investment advice. Nightshift doesn&apos;t sell
            tokens; Stock Tokens are not available to US persons. Market data comes from public feeds and may be delayed or simulated where
            marked. The Earn panel shows a third-party vault run by Sentora; deposits happen on Sentora&apos;s site, and Nightshift does not hold
            funds or control that vault.
          </p>
        </div>
      </footer>
      <Toaster />
      <WelcomeGuide />
      <JoinPrompt />
    </>
  );
}

export function SectionHead({ overline, title, lead, aside }: { overline: string; title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="section-head">
      <div>
        <p className="overline">{overline}</p>
        <h2>{title}</h2>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {aside && <div className="section-aside">{aside}</div>}
    </header>
  );
}

/** Title band at the top of each app page. */
export function PageHero({ overline, title, lead }: { overline: string; title: string; lead: React.ReactNode }) {
  return (
    <section className="block page-hero">
      <div className="wrap">
        <p className="overline-plain mono">{overline}</p>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
    </section>
  );
}

/** Nav + footer around a page's sections. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="ins-enter">{children}</main>
      <SiteFooter />
    </>
  );
}
