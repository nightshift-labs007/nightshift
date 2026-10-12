"use client";

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
type TurnstileApi = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };

/** Cloudflare Turnstile check for the faucet. Renders nothing unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. */
export function Turnstile({ onToken }: { onToken: (t: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    let id: string | null = null;
    const mount = () => {
      const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (!ts || !box.current) return;
      id = ts.render(box.current, { sitekey: SITE_KEY, theme: "dark", callback: (t: string) => onToken(t), "expired-callback": () => onToken(null) });
    };
    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) mount();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = mount;
      document.head.appendChild(s);
    }
    return () => {
      if (id) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(id);
    };
  }, [onToken]);
  return SITE_KEY ? <div ref={box} className="turnstile" /> : null;
}

export const turnstileEnabled = !!SITE_KEY;
