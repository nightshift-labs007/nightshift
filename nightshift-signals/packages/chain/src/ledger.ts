import { createWalletClient, decodeEventLog, defineChain, http, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LEDGER_ABI } from "./abi";
import { basketKey } from "./hash";

export interface CommitReceipt {
  txHash: Hex;
  status: "pending" | "confirmed";
  blockNumber: number | null;
  blockTime: Date | null;
}

export interface Ledger {
  readonly chainId: number;
  /** Sends the commit; resolves confirmed, or pending with the tx hash if it is not mined within `waitMs`. */
  commit(basketId: string, hash: Hex, waitMs: number): Promise<CommitReceipt>;
  /** Re-checks a pending commit. */
  receipt(txHash: Hex): Promise<CommitReceipt>;
}

export interface ViemLedgerConfig {
  rpcUrl: string;
  chainId: number;
  contract: string;
  /** Gas-only key. Never holds user funds. */
  privateKey: Hex;
  /** Commits arriving within this window share one commitBatch transaction. */
  batchWindowMs?: number;
}

interface Pending {
  basketId: string;
  hash: Hex;
  resolve: (tx: Hex) => void;
  reject: (e: unknown) => void;
}

export class ViemLedger implements Ledger {
  readonly chainId: number;
  private client;
  private queue: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private cfg: ViemLedgerConfig) {
    this.chainId = cfg.chainId;
    const chain = defineChain({
      id: cfg.chainId,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });
    this.client = createWalletClient({ account: privateKeyToAccount(cfg.privateKey), chain, transport: http(cfg.rpcUrl) }).extend(publicActions);
  }

  async commit(basketId: string, hash: Hex, waitMs: number): Promise<CommitReceipt> {
    const txHash = await new Promise<Hex>((resolve, reject) => {
      this.queue.push({ basketId, hash, resolve, reject });
      this.timer ??= setTimeout(() => void this.flush(), this.cfg.batchWindowMs ?? 250);
    });
    try {
      const r = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: waitMs });
      return this.toReceipt(txHash, r.blockNumber, r.status);
    } catch {
      return { txHash, status: "pending", blockNumber: null, blockTime: null };
    }
  }

  async receipt(txHash: Hex): Promise<CommitReceipt> {
    const r = await this.client.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!r) return { txHash, status: "pending", blockNumber: null, blockTime: null };
    return this.toReceipt(txHash, r.blockNumber, r.status);
  }

  private async toReceipt(txHash: Hex, blockNumber: bigint, status: "success" | "reverted"): Promise<CommitReceipt> {
    if (status !== "success") throw new Error(`commit tx ${txHash} reverted`);
    const block = await this.client.getBlock({ blockNumber });
    return { txHash, status: "confirmed", blockNumber: Number(blockNumber), blockTime: new Date(Number(block.timestamp) * 1000) };
  }

  private async flush() {
    const batch = this.queue.splice(0);
    this.timer = null;
    if (batch.length === 0) return;
    try {
      const contract = this.cfg.contract as Address;
      const tx =
        batch.length === 1
          ? await this.client.writeContract({ address: contract, abi: LEDGER_ABI, functionName: "commit", args: [basketKey(batch[0]!.basketId), batch[0]!.hash] })
          : await this.client.writeContract({
              address: contract,
              abi: LEDGER_ABI,
              functionName: "commitBatch",
              args: [batch.map((b) => basketKey(b.basketId)), batch.map((b) => b.hash)],
            });
      for (const b of batch) b.resolve(tx);
    } catch (e) {
      for (const b of batch) b.reject(e);
    }
  }
}

/**
 * Local stand-in with chain id 0: deterministic fake tx hashes, instant confirmation. The UI labels
 * these commits as simulated; they prove nothing and must never be shown as onchain proof.
 */
export class SimulatedLedger implements Ledger {
  readonly chainId = 0;
  private block = 1;

  async commit(basketId: string, hash: Hex): Promise<CommitReceipt> {
    const { keccak256, toBytes } = await import("viem");
    return { txHash: keccak256(toBytes(`sim:${basketId}:${hash}`)), status: "confirmed", blockNumber: this.block++, blockTime: new Date() };
  }

  async receipt(txHash: Hex): Promise<CommitReceipt> {
    return { txHash, status: "confirmed", blockNumber: this.block, blockTime: new Date() };
  }
}

/** Decodes a BasketCommitted log, for verification scripts. */
export function decodeCommitLog(log: { data: Hex; topics: [Hex, ...Hex[]] }) {
  return decodeEventLog({ abi: LEDGER_ABI, ...log });
}
