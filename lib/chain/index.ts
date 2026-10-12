import { defineChain, fallback, http, type Address, type Chain, type Transport } from "viem";
import abis from "./abis.json";
import deployment from "./deployment.json";

export type Deployment = {
  deployed: boolean;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string;
  deployedAt: string;
  startBlock: number;
  keeper: Address;
  owner?: Address;
  roles?: { updater: Address; keeper: Address; faucet: Address };
  symbolPrefix?: string; // "t" = testnet tokens, "d" = demo tokens on mainnet
  contracts: { usdg: Address; oracle: Address; vault: Address; verifier: Address };
  tokens: Record<string, { address: Address; lltv: number; adapter: Address }>;
};

export const DEPLOYMENT = deployment as unknown as Deployment;
export const isDeployed = DEPLOYMENT.deployed === true;
/** Base mainnet (chain 8453): demo assets with no value, no ETH faucet, explicit "unaudited demo" notices. */
export const isMainnet = isDeployed && DEPLOYMENT.chainId === 8453;
export const NETWORK = isDeployed ? (isMainnet ? "Base" : DEPLOYMENT.chainName) : "Base";
/** On-chain symbol for a Nightshift asset: tSPY / tUSDG on testnet, dSPY / dUSDG (demo, no value) on mainnet. */
export const sym = (asset: string) => `${DEPLOYMENT.symbolPrefix ?? (isMainnet ? "d" : "t")}${asset}`;

export const ABI = {
  token: abis.TestToken,
  oracle: abis.NightshiftOracle,
  vault: abis.NightshiftVault,
  verifier: abis.Groth16Verifier,
  adapter: abis.MorphoOracleAdapter,
} as const;

export function chainOf(d: Deployment = DEPLOYMENT): Chain {
  return defineChain({
    id: d.chainId,
    name: d.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
    blockExplorers: d.explorer ? { default: { name: "Explorer", url: d.explorer } } : undefined,
    testnet: d.chainId !== 8453,
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  });
}

// Public RPCs rate-limit (HTTP 429) under bursts of reads and sends, so every client spreads over several
// endpoints and retries; an optional BASE_RPC_URL / NEXT_PUBLIC_BASE_RPC_URL (e.g. a keyed Alchemy URL) goes first.
const EXTRA_RPCS: Record<number, string[]> = {
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org"],
  84532: ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"],
};
export function rpcUrls(d: Deployment = DEPLOYMENT): string[] {
  const own = typeof window === "undefined" ? process.env.BASE_RPC_URL : process.env.NEXT_PUBLIC_BASE_RPC_URL;
  return [...new Set([own, ...(EXTRA_RPCS[d.chainId] ?? []), d.rpcUrl].filter((u): u is string => !!u))];
}
export function chainTransport(d: Deployment = DEPLOYMENT): Transport {
  return fallback(rpcUrls(d).map((u) => http(u, { retryCount: 3, retryDelay: 800, timeout: 12_000 })));
}

export const txUrl = (hash: string) => (DEPLOYMENT.explorer ? `${DEPLOYMENT.explorer}/tx/${hash}` : "");
export const addrUrl = (a: string) => (DEPLOYMENT.explorer ? `${DEPLOYMENT.explorer}/address/${a}` : "");
export const tokenSymbols = () => Object.keys(DEPLOYMENT.tokens ?? {});
