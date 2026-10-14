import { createPublicClient } from "viem";
import { ABI, DEPLOYMENT, chainOf, chainTransport, isDeployed } from "./index";

type Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

/** On-chain prices lag the live Oracle by up to one keeper run, so allow a little more drift than the server's 0.5%. */
const ONCHAIN_PRICE_TOLERANCE = 0.01;

export type OnChainVerdict = {
  math: boolean; // the Groth16 verifier contract accepted the proof
  price: { ok: boolean; proofCents: number; onchainCents: number } | null; // proof's price vs NightshiftOracle on Base
  lltv: { ok: boolean; proofBps: number; onchainBps: number } | null; // proof's LLTV vs the Vault market on Base
  accepted: boolean; // all three hold: solvent at the real on-chain price and LLTV
};

/**
 * Checks a Cloak proof against Base, all with free read calls (no wallet needed):
 * 1. the deployed Groth16 verifier checks the proof's math, then
 * 2. the proof's public price and LLTV are compared with NightshiftOracle and the Vault market on Base.
 * The verifier contract alone only shows "solvent at the price the prover chose"; 2 makes it "solvent at the
 * protocol's price".
 */
export async function verifyOnChain(proof: Proof, publicSignals: string[], token?: string): Promise<OnChainVerdict | null> {
  if (!isDeployed) return null;
  const pub = createPublicClient({ chain: chainOf(), transport: chainTransport() });
  // snarkjs → Solidity calldata: G2 coordinates are swapped
  const args = [
    [proof.pi_a[0], proof.pi_a[1]],
    [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    [proof.pi_c[0], proof.pi_c[1]],
    publicSignals,
  ].map((x) => (Array.isArray(x) ? x.map((y) => (Array.isArray(y) ? y.map(BigInt) : BigInt(y))) : x));
  const math = (await pub.readContract({ address: DEPLOYMENT.contracts.verifier, abi: ABI.verifier as never, functionName: "verifyProof" as never, args: args as never })) as boolean;

  const t = token ? DEPLOYMENT.tokens[token] : undefined;
  if (!t) return { math, price: null, lltv: null, accepted: false };
  const [[p], [, l]] = (await Promise.all([
    pub.readContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle as never, functionName: "getPrice" as never, args: [t.address] as never }),
    pub.readContract({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault as never, functionName: "markets" as never, args: [t.address] as never }),
  ])) as [[bigint, number, bigint], [boolean, bigint]];
  // publicSignals = [commitment, priceCents, lltvBps]
  const proofCents = Number(publicSignals[1]);
  const proofBps = Number(publicSignals[2]);
  const onchainCents = Number(p / 10n ** 16n);
  const onchainBps = Number(l / 10n ** 14n);
  const price = { ok: onchainCents > 0 && Math.abs(proofCents / onchainCents - 1) <= ONCHAIN_PRICE_TOLERANCE, proofCents, onchainCents };
  const lltv = { ok: proofBps === onchainBps, proofBps, onchainBps };
  return { math, price, lltv, accepted: math && price.ok && lltv.ok };
}
