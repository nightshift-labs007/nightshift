import { NextResponse, type NextRequest } from "next/server";
import { formatEther, isAddress, parseEther, type Address } from "viem";
import { ABI, DEPLOYMENT } from "@/lib/chain";
import { keeperClients } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Gives a visitor what they need to try the testnet Vault with only a wallet:
// a little test ETH for gas plus test ETF tokens. Testnet assets only; amounts are small and capped.
const GAS_DRIP = parseEther("0.0004");
const GAS_FLOOR = parseEther("0.00015");
const KEEPER_RESERVE = parseEther("0.003");
const TOKEN_DRIP: Record<string, string> = { SPY: "10", QQQ: "10", GLD: "20", IBIT: "200" };
const recent = new Map<string, number>(); // per-instance rate limit

export async function POST(req: NextRequest) {
  const c = keeperClients();
  if (!c) return NextResponse.json({ error: "Testnet faucet is not configured yet." }, { status: 503 });
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  const who = address.toLowerCase();
  const last = recent.get(who) ?? 0;
  if (Date.now() - last < 10 * 60 * 1000) return NextResponse.json({ error: "Already sent recently. Try again in a few minutes." }, { status: 429 });
  recent.set(who, Date.now());

  const sent: { what: string; tx: string }[] = [];
  const keeperBal = await c.pub.getBalance({ address: c.account.address });
  const userBal = await c.pub.getBalance({ address: address as Address });
  if (userBal < GAS_FLOOR) {
    if (keeperBal < KEEPER_RESERVE + GAS_DRIP) return NextResponse.json({ error: "The demo gas faucet is empty. Please try again later." }, { status: 503 });
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
