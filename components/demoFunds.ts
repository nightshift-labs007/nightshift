"use client";

import type { EIP1193Provider } from "viem";
import { dripMessage, gasMessage } from "@/lib/drip";

export type Sent = { what: string; tx: string };

const signText = (provider: EIP1193Provider, account: string, text: string) => {
  const hex = `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return provider.request({ method: "personal_sign", params: [hex as `0x${string}`, account as `0x${string}`] }) as Promise<`0x${string}`>;
};

/**
 * One tap for everything a new wallet needs to try Borrow and Stack: demo ETF tokens and demo dUSDG (plus a little
 * gas on testnets). The visitor signs a free message to prove the address is theirs; the server sends the funds.
 */
export async function getDemoFunds(provider: EIP1193Provider, account: string, captcha: string | null): Promise<Sent[]> {
  const issuedAt = new Date().toISOString();
  const signature = await signText(provider, account, dripMessage(account, issuedAt));
  const res = await fetch("/api/drip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account, signature, issuedAt, turnstileToken: captcha }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "The faucet couldn't send right now.");
  return j.sent as Sent[];
}

/**
 * Nightshift pays registered users' test gas: before a transaction, a wallet that's almost out of test ETH asks the
 * server for a top-up. Uses the profile session when there is one; otherwise the wallet signs a free message.
 */
export async function ensureGas(provider: EIP1193Provider, account: string, balanceWei: bigint): Promise<void> {
  if (balanceWei >= 50_000_000_000_000n) return; // 0.00005 ETH: plenty for a few transactions
  const post = (body: object) => fetch("/api/gas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let res = await post({});
  if (res.status === 401) {
    const issuedAt = new Date().toISOString();
    const signature = await signText(provider, account, gasMessage(account, issuedAt));
    res = await post({ address: account, signature, issuedAt });
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? "Couldn't cover your gas right now.");
}
