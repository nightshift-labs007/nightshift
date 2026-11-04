"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";

const EVENT = "ns:member";

/** Tells every gate on the page that this wallet's sign-up status changed (e.g. right after it registered). */
export function memberChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/** Whether a wallet finished sign-up (invite code, verified email, username). null while loading. */
export function useRegistered(account: string | null) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  useEffect(() => {
    if (!account) return setRegistered(null);
    let alive = true;
    const load = () =>
      fetch(`/api/member?address=${account}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { registered?: boolean }) => alive && setRegistered(j.registered !== false))
        .catch(() => alive && setRegistered(true)); // store unreachable: don't lock people out
    setRegistered(null);
    load();
    window.addEventListener(EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, load);
    };
  }, [account]);
  return registered;
}

/** Counts each wallet as a Nightshift user the first time it connects. Rendered once, in the site shell. */
export function useCountConnect() {
  const w = useWallet();
  useEffect(() => {
    if (!w.account) return;
    const k = `ns-seen:${w.account.toLowerCase()}`;
    try {
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch {
      /* storage blocked: the server ignores repeats anyway */
    }
    fetch("/api/users/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: w.account }) }).catch(() => {});
  }, [w.account]);
}

export const SIGNUP_STEPS = ["Enter your invite code", "Verify your email", "Pick a username"];

/**
 * The wallet tools (Borrow with wallet, Stack) open once the connected wallet has finished sign-up. Without a wallet
 * the tools show their own "connect" prompt, so they render as they are; practice mode never needs sign-up.
 */
export function MemberGate({ children, what = "the wallet tools", practice }: { children: React.ReactNode; what?: string; practice?: () => void }) {
  const w = useWallet();
  const registered = useRegistered(w.account);
  if (!w.account || registered) return <>{children}</>;
  if (registered === null) return <div className="skeleton">Checking your account…</div>;
  return (
    <div className="card member-gate">
      <p className="pf-label">Invite only</p>
      <h3>Finish your profile to use {what}</h3>
      <p className="muted">Nightshift is invite-only for now. It takes about a minute:</p>
      <ol className="member-steps">
        {SIGNUP_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="member-gate-cta">
        <Link className="btn primary" href="/profile">Finish my profile</Link>
        {practice && <button className="pf-link" onClick={practice}>Or practise without a wallet</button>}
      </div>
    </div>
  );
}
