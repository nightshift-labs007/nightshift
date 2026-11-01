import { readFile } from "node:fs/promises";
import { formatUnits, type Address, type PublicClient } from "viem";
import { z } from "zod";
import { ERC20_ABI, type UniswapV3Config } from "./uniswap";
import type { RegistryEntry, RegistrySource } from "./types";

const Entry = z.object({
  symbol: z.string(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  underlying_ticker: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  pool_address: z.string().nullable().default(null),
  pool_fee: z.number().int().nullable().default(null),
  proxy: z.string().nullable().default(null),
  active: z.boolean().default(true),
});

/**
 * Reads the Stock Token list from a JSON file or URL you maintain from the official registry,
 * and measures pool depth onchain (USDG held by the pool, doubled).
 */
export class JsonRegistry implements RegistrySource {
  constructor(
    private location: string,
    private client: PublicClient | null,
    private uniswap: UniswapV3Config | null,
  ) {}

  async list(): Promise<RegistryEntry[]> {
    const raw = /^https?:/.test(this.location)
      ? await (await fetch(this.location, { signal: AbortSignal.timeout(5000) })).text()
      : await readFile(this.location, "utf8");
    return z.array(Entry).parse(JSON.parse(raw));
  }

  async poolLiquidityUsdg(entry: RegistryEntry): Promise<string | null> {
    if (!this.client || !this.uniswap || !entry.pool_address) return null;
    const bal = await this.client.readContract({
      address: this.uniswap.usdgAddress as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [entry.pool_address as Address],
    });
    return (Number(formatUnits(bal, this.uniswap.usdgDecimals)) * 2).toFixed(2);
  }
}
