import { NextResponse, type NextRequest } from "next/server";
import { formatEther, isAddress, type Address } from "viem";
import { ABI, DEPLOYMENT } from "@/lib/chain";
import { publicClient, readMany } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";

const SIDES = ["None", "Higher", "Lower"] as const;

/** One wallet's positions in the given rounds (?address=0x…&ids=1,2,3): side, stake, shares, claimed, what it's owed. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const address = q.get("address") ?? "";
  const ids = (q.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 60);
  const pm = DEPLOYMENT.predictions?.address as Address | undefined;
  const pub = publicClient();
  if (!isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  if (!pm || !pub) return NextResponse.json({ enabled: false, positions: [] });
  try {
    const res = (await readMany(pub, [
      { address: pm, abi: ABI.predictions, functionName: "isMember", args: [address] },
      { address: DEPLOYMENT.contracts.usdg, abi: ABI.token, functionName: "balanceOf", args: [address] },
      { address: DEPLOYMENT.contracts.usdg, abi: ABI.token, functionName: "allowance", args: [address, pm] },
      ...ids.flatMap((id) => [
        { address: pm, abi: ABI.predictions, functionName: "positions", args: [BigInt(id), address] },
        { address: pm, abi: ABI.predictions, functionName: "payoutOf", args: [BigInt(id), address] },
      ]),
    ])) as unknown[];
    const [member, balance, allowance, ...rest] = res as [boolean, bigint, bigint, ...unknown[]];
    const positions = ids
      .map((id, i) => {
        const [side, claimed, stake, shares] = rest[i * 2] as [number, boolean, bigint, bigint];
        const owed = rest[i * 2 + 1] as bigint;
        return { id, side: SIDES[side], claimed, stake: Number(formatEther(stake)), shares: Number(formatEther(shares)), owed: Number(formatEther(owed)) };
      })
      .filter((p) => p.stake > 0);
    return NextResponse.json(
      { enabled: true, member, balance: Number(formatEther(balance)), allowance: Number(formatEther(allowance)), positions },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 503 });
  }
}
