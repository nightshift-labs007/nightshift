import { NextResponse } from "next/server";
import { createPublicClient, formatEther, http } from "viem";
import { ABI, DEPLOYMENT, chainOf, isDeployed } from "@/lib/chain";

export const dynamic = "force-dynamic";

// Public status of the testnet deployment: on-chain Oracle prices and vault totals.
export async function GET() {
  if (!isDeployed) return NextResponse.json({ deployed: false });
  try {
    const pub = createPublicClient({ chain: chainOf(), transport: http(DEPLOYMENT.rpcUrl) });
    const prices = await Promise.all(
      Object.entries(DEPLOYMENT.tokens).map(async ([sym, t]) => {
        const [p, conf, at] = (await pub.readContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "getPrice", args: [t.address] })) as [bigint, number, bigint];
        return { token: sym, price: Number(formatEther(p)), confidence: conf, updatedAt: Number(at) };
      }),
    );
    const positions = Number(await pub.readContract({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault, functionName: "positionCount" }));
    const keeperBalance = Number(formatEther(await pub.getBalance({ address: DEPLOYMENT.keeper })));
    return NextResponse.json(
      { deployed: true, chainId: DEPLOYMENT.chainId, chainName: DEPLOYMENT.chainName, explorer: DEPLOYMENT.explorer, contracts: DEPLOYMENT.contracts, prices, positions, keeperBalance },
      { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (e) {
    return NextResponse.json({ deployed: true, error: String(e).slice(0, 200) }, { status: 502 });
  }
}
