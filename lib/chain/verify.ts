import { createPublicClient } from "viem";
import { ABI, DEPLOYMENT, chainOf, chainTransport, isDeployed } from "./index";

type Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

/** Checks a Groth16 proof with the deployed Solidity verifier (a free read call, no wallet needed). */
export async function verifyOnChain(proof: Proof, publicSignals: string[]): Promise<boolean | null> {
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
  return (await pub.readContract({ address: DEPLOYMENT.contracts.verifier, abi: ABI.verifier as never, functionName: "verifyProof" as never, args: args as never })) as boolean;
}
