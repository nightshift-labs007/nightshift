"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";

const VKEY = (a: string) => `ns-avatar-v:${a.toLowerCase()}`;
const EVENT = "ns:avatar";

/** Tells every avatar on the page (the top bar, the profile page) that this wallet's photo changed. */
export function avatarChanged(address: string, version: number | null) {
  try {
    if (version) localStorage.setItem(VKEY(address), String(version));
    else localStorage.removeItem(VKEY(address));
  } catch {
    /* storage blocked: the change still shows on this page */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { address: address.toLowerCase(), version } }));
}

/**
 * A wallet's profile photo, or a gradient badge drawn from the address (with the name's first letter) when there is
 * none or it isn't public. `version` busts the browser's cache after a new upload.
 */
export function ProfileAvatar({ address, name, size = 40, version, className = "" }: { address: string; name?: string; size?: number; version?: number | null; className?: string }) {
  // always try the server first (a photo may come from another device); the version only refreshes the cached copy
  const [v, setV] = useState<number | undefined>(version ?? undefined);
  const [failed, setFailed] = useState(version === null);
  useEffect(() => {
    if (version !== undefined) {
      setV(version ?? undefined);
      setFailed(version === null);
      return;
    }
    let stored: number | undefined;
    try {
      stored = Number(localStorage.getItem(VKEY(address))) || undefined;
    } catch {
      /* storage blocked */
    }
    setV(stored);
    setFailed(false);
  }, [address, version]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ address: string; version: number | null }>).detail;
      if (d.address !== address.toLowerCase()) return;
      setV(d.version ?? undefined);
      setFailed(!d.version);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [address]);

  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(address.slice(8, 12), 16) % 140)) % 360;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (failed)
    return (
      <span className={`pf-avatar ${className}`} style={{ ...style, background: `linear-gradient(135deg, hsl(${h1} 55% 62%), hsl(${h2} 50% 38%))` }} aria-hidden="true">
        {(name || "").trim().slice(0, 1).toUpperCase()}
      </span>
    );
  return (
    <img
      className={`pf-avatar pf-photo ${className}`}
      style={style}
      src={`/api/profile/avatar/${address.toLowerCase()}${v ? `?v=${v}` : ""}`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
