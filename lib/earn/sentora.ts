import "server-only";
import { EARN_TXS, EARN_WALLET } from "@/lib/team-wallets";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

// Phase 1 of the Sentora integration: a read-only view of Sentora Protected RWA, the Firelight-covered PYUSD vault
// on Ethereum (vaults.sentora.com lists it at $2.2M TVL; DefiLlama tracks it as "Sentora PRIME"). Nightshift never
// touches funds. Every default below can be overridden by the matching SENTORA_* environment variable.
const CONFIG = {
  name: process.env.SENTORA_VAULT_NAME || "Sentora Protected RWA",
  chain: "Ethereum",
  asset: "PYUSD",
  // DefiLlama yields pool id (daily share-price history + current APY and TVL)
  llamaPool: process.env.SENTORA_LLAMA_POOL ?? "64d85231-3132-5684-86e9-572888258092",
  // vault contract; the current share price and TVL are read from it on-chain
  vaultAddress: (process.env.SENTORA_VAULT_ADDRESS || "0xd000E6BcAd5457E8F4de67eDdeFe50BCC4B3d743") as `0x${string}`,
  rpcUrl: process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
  confirmed: process.env.SENTORA_VAULT_CONFIRMED !== "false",
  coverActive: process.env.SENTORA_FIRELIGHT_COVER !== "false", // the vault carries Sentora's "Protected" (Firelight) badge
  depositBase: process.env.SENTORA_DEPOSIT_URL || "https://vaults.sentora.com/vault/ethereum/0xd000E6BcAd5457E8F4de67eDdeFe50BCC4B3d743",
  // Sentora's own "Est. APY 7d" from vaults.sentora.com. Their API isn't public, so it's set by hand;
  // update SENTORA_APY_7D / SENTORA_APY_AS_OF when Sentora's figure changes; "off" disables it.
  publishedApy7d: process.env.SENTORA_APY_7D || "8.9",
  publishedAsOf: process.env.SENTORA_APY_AS_OF || "2026-10-12",
};

function published(): { apy: number; asOf: string } | null {
  const apy = Number(CONFIG.publishedApy7d);
  return CONFIG.publishedApy7d !== "off" && Number.isFinite(apy) ? { apy, asOf: CONFIG.publishedAsOf } : null;
}

const UTM = { utm_source: "nightshift", utm_medium: "earn_panel", utm_campaign: "sentora_phase1" };
const STALE_AFTER_MS = 60 * 60 * 1000;

export type EarnPoint = { t: string; apy: number; sharePrice: number; tvl: number };

export type SentoraEarn = {
  vault: { name: string; chain: string; asset: string; confirmed: boolean; address: string | null };
  apy7d: number | null; // % a year, from share-price growth over 7 days
  apy30d: number | null; // % a year, from share-price growth over 30 days
  apyReported: number | null; // DefiLlama's current figure, for cross-checking
  apyPublished: { apy: number; asOf: string } | null; // Sentora's own 7-day figure, set in config
  tvl: number | null; // USD (PYUSD is 1:1 with the dollar)
  sharePrice: number | null; // PYUSD per vault share
  coverActive: boolean;
  history: EarnPoint[]; // last 30 days, daily
  source: "onchain+defillama" | "defillama";
  updatedAt: string; // when Nightshift last read the data successfully
  dataAt: string | null; // timestamp of the latest data point
  stale: boolean;
  depositUrl: string;
  /** the team's own small position in this vault, read live from the chain */
  team: { wallet: string; shares: number; valuePyusd: number; txs: { id: string; title: string }[] } | null;
};

/** APY = (P_now / P_then) ^ (365 / d) − 1, with d the actual elapsed days between the two share prices. */
export function annualise(pNow: number, tNow: number, pThen: number, tThen: number): number | null {
  const days = (tNow - tThen) / 86_400_000;
  if (!(pNow > 0 && pThen > 0) || days < 1) return null;
  return (Math.pow(pNow / pThen, 365 / days) - 1) * 100;
}

function depositUrl() {
  const u = new URL(CONFIG.depositBase);
  for (const [k, v] of Object.entries(UTM)) u.searchParams.set(k, v);
  return u.toString();
}

type LlamaPoint = { timestamp: string; tvlUsd: number; apy: number | null; pricePerShare?: number | null };

async function fromDefiLlama(): Promise<EarnPoint[]> {
  const res = await fetch(`https://yields.llama.fi/chart/${CONFIG.llamaPool}`, {
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
  const json = (await res.json()) as { data?: LlamaPoint[] };
  return (json.data ?? [])
    .filter((p) => typeof p.pricePerShare === "number" && p.pricePerShare > 0)
    .map((p) => ({ t: p.timestamp, apy: p.apy ?? 0, sharePrice: p.pricePerShare as number, tvl: p.tvlUsd }));
}

// Sentora's vault isn't ERC-4626: it reports the share price and total assets directly, both in the asset's units
// (the same calls DefiLlama's Sentora adapter uses).
const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function getSharePrice() view returns (uint256)",
  "function getTotalAssets() view returns (uint256)",
  "function lpTokenAddress() view returns (address)",
]);
const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);

async function fromChain(address: `0x${string}`) {
  const client = createPublicClient({ chain: mainnet, transport: http(CONFIG.rpcUrl, { timeout: 8000 }) });
  const asset = await client.readContract({ address, abi: VAULT_ABI, functionName: "asset" });
  const [assetDec, price, total] = await Promise.all([
    client.readContract({ address: asset, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address, abi: VAULT_ABI, functionName: "getSharePrice" }),
    client.readContract({ address, abi: VAULT_ABI, functionName: "getTotalAssets" }),
  ]);
  const scale = 10 ** assetDec;
  const sharePrice = Number(price) / scale;
  // the team wallet's vault shares (the vault's own LP token, same decimals as the asset)
  const lp = await client.readContract({ address, abi: VAULT_ABI, functionName: "lpTokenAddress" });
  const shares = Number(await client.readContract({ address: lp, abi: ERC20_ABI, functionName: "balanceOf", args: [EARN_WALLET] })) / scale;
  const team = shares > 0 ? { wallet: EARN_WALLET, shares, valuePyusd: shares * sharePrice, txs: EARN_TXS.map((t) => ({ id: t.id, title: t.title })) } : null;
  return { sharePrice, tvl: Number(total) / scale, team };
}

// last good read, kept per server instance; reads are also cached by the fetch layer for 10 minutes
let lastGood: Omit<SentoraEarn, "stale"> | null = null;

export async function getSentoraEarn(): Promise<SentoraEarn> {
  try {
    const points = await fromDefiLlama();
    if (points.length < 2) throw new Error("no share-price history");
    const latest = points[points.length - 1];
    let nowP = latest.sharePrice;
    let nowT = Date.parse(latest.t);
    let tvl: number | null = latest.tvl;
    let source: SentoraEarn["source"] = "defillama";
    let team: SentoraEarn["team"] = null;
    if (CONFIG.vaultAddress) {
      try {
        const chain = await fromChain(CONFIG.vaultAddress);
        nowP = chain.sharePrice;
        nowT = Date.now();
        tvl = chain.tvl;
        team = chain.team;
        source = "onchain+defillama";
      } catch {
        // RPC hiccup: DefiLlama's latest point still gives a current share price
      }
    }
    // the share price on or before (now - d days)
    const at = (d: number) => {
      const cut = nowT - d * 86_400_000;
      let hit: EarnPoint | null = null;
      for (const p of points) if (Date.parse(p.t) <= cut) hit = p;
      return hit;
    };
    const p7 = at(7);
    const p30 = at(30);
    const data: Omit<SentoraEarn, "stale"> = {
      vault: { name: CONFIG.name, chain: CONFIG.chain, asset: CONFIG.asset, confirmed: CONFIG.confirmed, address: CONFIG.vaultAddress ?? null },
      apy7d: p7 ? annualise(nowP, nowT, p7.sharePrice, Date.parse(p7.t)) : null,
      apy30d: p30 ? annualise(nowP, nowT, p30.sharePrice, Date.parse(p30.t)) : null,
      apyReported: latest.apy ?? null,
      apyPublished: published(),
      tvl,
      sharePrice: nowP,
      coverActive: CONFIG.coverActive,
      history: points.filter((p) => Date.parse(p.t) >= nowT - 31 * 86_400_000),
      source,
      updatedAt: new Date().toISOString(),
      dataAt: new Date(nowT).toISOString(),
      depositUrl: depositUrl(),
      team,
    };
    lastGood = data;
    return { ...data, stale: false };
  } catch {
    if (lastGood) return { ...lastGood, stale: Date.now() - Date.parse(lastGood.updatedAt) > STALE_AFTER_MS };
    return {
      vault: { name: CONFIG.name, chain: CONFIG.chain, asset: CONFIG.asset, confirmed: CONFIG.confirmed, address: CONFIG.vaultAddress ?? null },
      apy7d: null,
      apy30d: null,
      apyReported: null,
      apyPublished: published(),
      tvl: null,
      sharePrice: null,
      coverActive: CONFIG.coverActive,
      history: [],
      source: "defillama",
      updatedAt: new Date(0).toISOString(),
      dataAt: null,
      stale: true,
      depositUrl: depositUrl(),
      team: null,
    };
  }
}
