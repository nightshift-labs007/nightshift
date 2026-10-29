"use client";

import type { EIP1193Provider } from "viem";
import { dripMessage } from "@/lib/drip";

export type Sent = { what: string; tx: string };

/**
 * One tap for everything a new wallet needs to try Borrow and Stack: demo ETF tokens and demo dUSDG (plus a little
 * gas on testnets). The visitor signs a free message to prove the address is theirs; the server sends the funds.
 */
export async function getDemoFunds(provider: EIP1193Provider, account: string, captcha: string | null): Promise<Sent[]> {
  const issuedAt = new Date().toISOString();
  const hex = `0x${Array.from(new TextEncoder().encode(dripMessage(account, issuedAt)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const signature = (await provider.request({ method: "personal_sign", params: [hex as `0x${string}`, account as `0x${string}`] })) as `0x${string}`;
  const res = await fetch("/api/drip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account, signature, issuedAt, turnstileToken: captcha }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "The faucet couldn't send right now.");
  return j.sent as Sent[];
}
