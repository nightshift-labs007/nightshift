"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const EVENT = "ns:member"; // the same event Member.tsx's memberChanged() sends

/**
 * Whether this browser has a Nightshift session (set only by verifying the email code: invite + email sign-up, or the
 * email login that creates a Nightshift wallet). null while checking. When profiles aren't configured (a local server
 * without the store) everything stays open.
 */
export function useSignedIn(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/profile", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { enabled?: boolean; signedIn?: boolean; error?: string }) => alive && setOk(j.enabled === false || !!j.signedIn || !!j.error))
        .catch(() => alive && setOk(true)); // store unreachable: don't lock people out
    load();
    window.addEventListener(EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, load);
    };
  }, []);
  return ok;
}

/** Shows `children` only to signed-in visitors; everyone else gets a sign-in card that brings them back here after. */
export function SignedInGate({ children, what = "live prices" }: { children: React.ReactNode; what?: string }) {
  const ok = useSignedIn();
  if (ok === null) return <div className="wrap"><div className="skeleton signin-wait">Checking your session…</div></div>;
  if (ok) return <>{children}</>;
  const next = typeof window !== "undefined" ? window.location.pathname + window.location.hash : "/app";
  return (
    <section className="block">
      <div className="wrap">
        <div className="panel signin-gate">
          <p className="mono xs muted">MEMBERS ONLY</p>
          <h2>Sign in to see {what}.</h2>
          <p className="muted">
            Nightshift is invite-only for now. Sign in with your email (a 6-digit code, no signatures). New here? Your invite code and email
            get you in in about a minute.
          </p>
          <div className="signin-gate-cta">
            <Link className="btn primary" href={`/profile?next=${encodeURIComponent(next)}`}>Sign in with email</Link>
            <Link className="btn secondary" href="/">What is Nightshift?</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
