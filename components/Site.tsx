"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { Toaster } from "./Toast";
import { WalletButton } from "./WalletButton";

/** Pages, by user goal. Stocks and Earn live on the landing page. */
export const NAV = [
  { href: "/app", label: "App" },
  { href: "/oracle", label: "Oracle" },
  { href: "/proof", label: "Proof" },
  { href: "/transparency", label: "Transparency" },
  { href: "/#stocks", label: "Stocks" },
  { href: "/#earn", label: "Earn" },
];

export function SiteNav() {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setMenu(false), [path]);
  return (
    <nav className={`nav ${menu ? "open" : ""} ${scrolled ? "scrolled" : ""}`} aria-label="Main">
      <div className="wrap nav-inner">
        <Link className="brand" href="/">
          <BrandMark /> Nightshift
        </Link>
        <div className="nav-links" id="nav-links">
          {NAV.map((n) => {
            const active = !n.href.includes("#") && path === n.href;
            return (
              <Link key={n.href} href={n.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                {n.label}
              </Link>
            );
          })}
        </div>
        <WalletButton />
        {path !== "/app" && (
          <Link className="btn primary small nav-cta" href="/app">
            Launch app
          </Link>
        )}
        <button className="menu-btn" aria-expanded={menu} aria-controls="nav-links" onClick={() => setMenu(!menu)}>
          <span />
          <span />
          <span className="sr-only">Menu</span>
        </button>
      </div>
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
            Concept demonstration on test networks: no real funds. Oracle values are data, not investment advice. Nightshift doesn&apos;t sell
            tokens; Stock Tokens are not available to US persons. Market data comes from public feeds and may be delayed or simulated where
            marked. The Earn panel shows a third-party vault run by Sentora; deposits happen on Sentora&apos;s site, and Nightshift does not hold
            funds or control that vault.
          </p>
        </div>
      </footer>
      <Toaster />
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
