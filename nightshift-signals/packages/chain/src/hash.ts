import { basketCanonicalJson, type Basket } from "@nightshift-signals/core";
import { keccak256, toBytes } from "viem";

/** canonical_hash = keccak256(canonical JSON). Anyone can recompute it from the public basket. */
export function basketHash(b: Basket): `0x${string}` {
  return keccak256(toBytes(basketCanonicalJson(b)));
}

/** Indexed onchain key: keccak256 of the basket id string. */
export function basketKey(id: string): `0x${string}` {
  return keccak256(toBytes(id));
}
