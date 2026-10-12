import { defineChain, type Address, type Chain } from "viem";
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
  contracts: { usdg: Address; oracle: Address; vault: Address; verifier: Address };
  tokens: Record<string, { address: Address; lltv: number; adapter: Address }>;
};

export const DEPLOYMENT = deployment as unknown as Deployment;
export const isDeployed = DEPLOYMENT.deployed === true;

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
    testnet: true,
  });
}

export const txUrl = (hash: string) => (DEPLOYMENT.explorer ? `${DEPLOYMENT.explorer}/tx/${hash}` : "");
export const addrUrl = (a: string) => (DEPLOYMENT.explorer ? `${DEPLOYMENT.explorer}/address/${a}` : "");
export const tokenSymbols = () => Object.keys(DEPLOYMENT.tokens ?? {});
