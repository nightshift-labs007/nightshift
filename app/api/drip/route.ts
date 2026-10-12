import { NextResponse, type NextRequest } from "next/server";
import { formatEther, isAddress, parseEther, recoverMessageAddress, type Address } from "viem";
import { ABI, DEPLOYMENT } from "@/lib/chain";
import { roleClients } from "@/lib/chain/keeper";
import { env } from "@/lib/env";
import { take } from "@/lib/ratelimit";
import { dripMessage } from "@/lib/drip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Gives a visitor what they need to try the testnet Vault with only a wallet: a little test ETH for gas plus
// test ETF tokens. Uses its own faucet wallet (never the oracle updater or keeper), and is protected by:
// a signed message proving the visitor controls the address, a 24h limit per address and per IP (durable when
// Upstash Redis is configured), an optional Cloudflare Turnstile check, and a reserve the faucet never spends.
const GAS_DRIP = parseEther("0.0004");
const GAS_FLOOR = parseEther("0.00015");
const FAUCET_RESERVE = parseEther("0.001");
const TOKEN_DRIP: Record<string, string> = { SPY: "10", QQQ: "10", GLD: "20", IBIT: "200" };
const WINDOW_SEC = 24 * 3600;
const SIG_MAX_AGE_MS = 5 * 60 * 1000;

async function turnstileOk(token: string | undefined, ip: string) {
  if (!env.turnstileSecret) return true; // captcha not configured
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.turnstileSecret, response: token, remoteip: ip }),
  }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { success?: boolean } | null;
  return j?.success === true;
}

export async function POST(req: NextRequest) {
  const c = roleClients("faucet");
  if (!c) return NextResponse.json({ error: "Testnet faucet is not configured yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { address?: string; signature?: `0x${string}`; issuedAt?: string; turnstileToken?: string };
  const { address, signature, issuedAt } = body;
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });

  // 1. proof the visitor controls the address
  const age = Date.now() - Date.parse(issuedAt ?? "");
  if (!signature || !(age >= -60_000 && age < SIG_MAX_AGE_MS)) return NextResponse.json({ error: "Please sign the faucet message in your wallet." }, { status: 401 });
  const signer = await recoverMessageAddress({ message: dripMessage(address, issuedAt!), signature }).catch(() => null);
  if (!signer || signer.toLowerCase() !== address.toLowerCase()) return NextResponse.json({ error: "Signature doesn't match this address." }, { status: 401 });

  // 2. captcha (when configured)
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await turnstileOk(body.turnstileToken, ip))) return NextResponse.json({ error: "Captcha check failed. Please try again." }, { status: 403 });

  // 3. one drip per address and per IP per 24 hours
  if (!(await take(`drip:addr:${address.toLowerCase()}`, WINDOW_SEC))) return NextResponse.json({ error: "This address already received test funds today." }, { status: 429 });
  if (!(await take(`drip:ip:${ip}`, WINDOW_SEC))) return NextResponse.json({ error: "Test funds were already sent to this network today." }, { status: 429 });

  const sent: { what: string; tx: string }[] = [];
  const faucetBal = await c.pub.getBalance({ address: c.account.address });
  const userBal = await c.pub.getBalance({ address: address as Address });
  if (userBal < GAS_FLOOR) {
    if (faucetBal < FAUCET_RESERVE + GAS_DRIP) return NextResponse.json({ error: "The demo gas faucet is empty. Please try again later." }, { status: 503 });
    const tx = await c.wallet.sendTransaction({ to: address as Address, value: GAS_DRIP });
    sent.push({ what: `${formatEther(GAS_DRIP)} test ETH`, tx });
  }
  for (const [sym, amount] of Object.entries(TOKEN_DRIP)) {
    const t = DEPLOYMENT.tokens[sym];
    if (!t) continue;
    const bal = (await c.pub.readContract({ address: t.address, abi: ABI.token, functionName: "balanceOf", args: [address] })) as bigint;
    if (bal >= parseEther(amount)) continue;
    const tx = await c.wallet.writeContract({ address: t.address, abi: ABI.token, functionName: "mint", args: [address, parseEther(amount)] });
    sent.push({ what: `${amount} t${sym}`, tx });
  }
  if (sent.length) await c.pub.waitForTransactionReceipt({ hash: sent[sent.length - 1].tx as `0x${string}` });
  return NextResponse.json({ sent });
}
