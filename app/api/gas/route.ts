import { NextResponse, type NextRequest } from "next/server";
import { formatEther, isAddress, parseEther, recoverMessageAddress, type Address } from "viem";
import { isMainnet } from "@/lib/chain";
import { roleClients } from "@/lib/chain/keeper";
import { gasMessage } from "@/lib/drip";
import { isRegistered, signupRequired } from "@/lib/members";
import { SESSION_COOKIE, readSession } from "@/lib/profile";
import { allow, take } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Nightshift pays registered users' gas: a wallet below GAS_FLOOR gets GAS_TOPUP from the faucet wallet, at most once
// per COOLDOWN_SEC, and never more than DAILY_CAP top-ups a day in total. On Base mainnet the ETH is real, so the amounts
// are small: a transaction there costs about 0.000002 ETH, so 0.00003 covers a dozen or more.
const MAINNET = { topup: parseEther("0.00003"), floor: parseEther("0.00001"), reserve: parseEther("0.0002"), cooldown: 24 * 3600, dailyCap: 25 };
const TESTNET = { topup: parseEther("0.0004"), floor: parseEther("0.00005"), reserve: parseEther("0.002"), cooldown: 6 * 3600, dailyCap: 500 };
const { topup: GAS_TOPUP, floor: GAS_FLOOR, reserve: FAUCET_RESERVE, cooldown: COOLDOWN_SEC, dailyCap: DAILY_CAP } = isMainnet ? MAINNET : TESTNET;
const SIG_MAX_AGE_MS = 5 * 60 * 1000;

/** Tops up a registered wallet's ETH for gas. Proof of the wallet: the profile session cookie, or a signed message. */
export async function POST(req: NextRequest) {
  const c = roleClients("faucet");
  if (!c) return NextResponse.json({ error: "Gas top-ups aren't configured." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { address?: string; signature?: `0x${string}`; issuedAt?: string };
  let address = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!address && body.address && isAddress(body.address) && body.signature && body.issuedAt) {
    const age = Date.now() - Date.parse(body.issuedAt);
    const signer =
      age >= -60_000 && age < SIG_MAX_AGE_MS
        ? await recoverMessageAddress({ message: gasMessage(body.address, body.issuedAt), signature: body.signature }).catch(() => null)
        : null;
    if (signer?.toLowerCase() === body.address.toLowerCase()) address = body.address.toLowerCase();
  }
  if (!address) return NextResponse.json({ error: "sign" }, { status: 401 });
  if (signupRequired() && !(await isRegistered(address).catch(() => false)))
    return NextResponse.json({ error: "Finish sign-up first: Nightshift covers gas for registered users." }, { status: 403 });

  const bal = await c.pub.getBalance({ address: address as Address });
  if (bal >= GAS_FLOOR) return NextResponse.json({ sent: false, balance: formatEther(bal) });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`gas:ip:${ip}`, 20, 86400)).ok) return NextResponse.json({ error: "Too many gas top-ups from this network today." }, { status: 429 });
  if (!(await take(`gas:addr:${address}`, COOLDOWN_SEC))) return NextResponse.json({ error: "This wallet got gas recently. Try again later." }, { status: 429 });
  if (!(await allow("gas:all", DAILY_CAP, 86400)).ok) return NextResponse.json({ error: "Today's free gas is used up. Please try again tomorrow." }, { status: 429 });
  if ((await c.pub.getBalance({ address: c.account.address })) < FAUCET_RESERVE + GAS_TOPUP)
    return NextResponse.json({ error: "The gas fund is empty right now. Please try again later." }, { status: 503 });
  try {
    const nonce = await c.pub.getTransactionCount({ address: c.account.address, blockTag: "pending" });
    const tx = await c.wallet.sendTransaction({ to: address as Address, value: GAS_TOPUP, nonce });
    await c.pub.waitForTransactionReceipt({ hash: tx });
    return NextResponse.json({ sent: true, amount: formatEther(GAS_TOPUP), tx });
  } catch (e) {
    console.error("gas top-up failed", e);
    return NextResponse.json({ error: "Couldn't send gas right now. Please try again in a minute." }, { status: 502 });
  }
}
