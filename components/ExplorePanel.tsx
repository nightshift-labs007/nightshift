"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INTEGRATIONS, PAGE_GROUPS, PAGES } from "@/lib/sitemap";
import { readMuted } from "./AlwaysOnAudio";

/**
 * Left slide-out panel: every page and what it does, then every integration with its logo, how Nightshift uses it,
 * and where it shows up on the site. Opens from the nav button, or by swiping in from the left edge on touch screens.
 */
export function ExplorePanel({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const path = usePathname();
  const panel = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // the soundtrack switch lives here (AlwaysOnAudio plays it), so no button floats over the page
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(readMuted());
    const on = (e: Event) => setMuted((e as CustomEvent<boolean>).detail);
    window.addEventListener("ns:audio-state", on);
    return () => window.removeEventListener("ns:audio-state", on);
  }, []);
  // the App page has two tabs (Borrow, Stack) told apart by the hash, so the menu tracks it to show the right one
  const [hash, setHash] = useState("");
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [path, open]);

  useEffect(() => setOpen(false), [path, setOpen]);

  // swipe in from the left edge to open, swipe left to close
  useEffect(() => {
    let x0 = -1, y0 = 0;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      x0 = open || t.clientX < 24 ? t.clientX : -1;
      y0 = t.clientY;
    };
    const end = (e: TouchEvent) => {
      if (x0 < 0) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dy > Math.abs(dx)) return; // vertical scroll, not a swipe
      if (!open && dx > 60) setOpen(true);
      else if (open && dx < -60) setOpen(false);
      x0 = -1;
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchend", end); };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(".xp-close")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("a[href], button");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, setOpen]);

  if (!mounted) return null;
  // portal: the sticky, blurred nav would otherwise be the containing block for this fixed panel
  return createPortal(
    <div className={`xp ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="xp-backdrop" onClick={() => setOpen(false)} />
      <aside className="xp-panel" ref={panel} role="dialog" aria-modal="true" aria-label="Explore Nightshift" inert={!open}>
        <header className="xp-head">
          <p className="xp-title">Explore Nightshift</p>
          <button className="xp-close" onClick={() => setOpen(false)} aria-label="Close panel">×</button>
        </header>

        {PAGE_GROUPS.map((g) => (
          <div key={g.id}>
            <p className="xp-label">{g.label}</p>
            <ul className="xp-pages">
              {PAGES.filter((p) => p.group === g.id).map((p) => {
                const [pPath, pHash = ""] = p.href.split("#");
                // the landing-page sections (/#stocks, /#earn) are never "current"; /app is Borrow unless the Stack tab is open
                const active = pPath === path && pPath !== "/" && (pHash ? hash === `#${pHash}` : hash !== "#stack");
                return (
                  <li key={p.href}>
                    <Link
                      href={p.href}
                      className={active ? "active" : ""}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        setOpen(false);
                        // a hash link on the page you're already on doesn't fire hashchange; tell the page (e.g. the App's tabs)
                        if (pPath === path) setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 0);
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={p.icon} /></svg>
                      <span>
                        <b>{p.label}</b>
                        <small>
                          <i className="xp-tech">{p.tech}</i> · {p.what}
                        </small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <p className="xp-label">Help and settings</p>
        <div className="xp-settings">
          <button
            onClick={() => {
              setOpen(false);
              window.setTimeout(() => window.dispatchEvent(new Event("ns:guide-open")), 200);
            }}
          >
            <span aria-hidden="true">?</span> Show me how this page works
          </button>
          <button onClick={() => window.dispatchEvent(new Event("ns:audio-toggle"))} aria-pressed={!muted}>
            <span aria-hidden="true">♪</span> Soundtrack: {muted ? "off" : "on"}
          </button>
        </div>

        <p className="xp-label">Integrated protocols</p>
        <ul className="xp-integrations">
          {INTEGRATIONS.map((x) => (
            <li key={x.name}>
              <div className="xp-int-top">
                <span className={`integration-logo small ${x.light ? "light" : ""}`}>
                  <img src={x.logo} alt="" width={26} height={26} />
                </span>
                <span>
                  <b>{x.name}</b>
                  <small>{x.role}</small>
                </span>
              </div>
              <p>{x.short}</p>
              <div className="xp-int-links">
                <Link href={x.page.href} onClick={() => setOpen(false)}>On the site: {x.page.label} →</Link>
                <a href={`https://x.com/${x.handle}`} target="_blank" rel="noopener noreferrer">@{x.handle} ↗</a>
              </div>
            </li>
          ))}
        </ul>
        <p className="xp-foot">Logos belong to their owners and show technical integrations, not endorsement or partnership.</p>
      </aside>
    </div>,
    document.body,
  );
}
