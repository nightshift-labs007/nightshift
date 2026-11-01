import { createPublicClient, defineChain, formatUnits, http, parseUnits, type Address, type PublicClient } from "viem";
import { QuoteError, type QuoteSource, type TokenRef } from "./types";

const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
}

export function chainClient({ rpcUrl, chainId }: ChainConfig): PublicClient {
  const chain = defineChain({
    id: chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 4000 }) }) as PublicClient;
}

export interface UniswapV3Config {
  quoterAddress: string;
  usdgAddress: string;
  usdgDecimals: number;
}

/**
 * Uniswap v3 QuoterV2. Which Uniswap version is deployed on Robinhood Chain, and its addresses,
 * must be confirmed from official docs; a v4 deployment needs a V4Quoter adapter instead.
 */
export class UniswapV3Quotes implements QuoteSource {
  constructor(
    private client: PublicClient,
    private cfg: UniswapV3Config,
  ) {}

  async buy(token: TokenRef, usdgIn: string) {
    const out = await this.quote(this.cfg.usdgAddress, token.address, parseUnits(usdgIn, this.cfg.usdgDecimals), token);
    return { tokensOut: formatUnits(out, token.decimals) };
  }

  async sell(token: TokenRef, tokensIn: string) {
    const out = await this.quote(token.address, this.cfg.usdgAddress, parseUnits(tokensIn, token.decimals), token);
    return { usdgOut: formatUnits(out, this.cfg.usdgDecimals) };
  }

  private async quote(tokenIn: string, tokenOut: string, amountIn: bigint, token: TokenRef): Promise<bigint> {
    if (token.poolFee === null) throw new QuoteError("no_pool", `${token.symbol} has no pool fee tier`);
    try {
      const { result } = await this.client.simulateContract({
        address: this.cfg.quoterAddress as Address,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: tokenIn as Address, tokenOut: tokenOut as Address, amountIn, fee: token.poolFee, sqrtPriceLimitX96: 0n }],
      });
      return result[0];
    } catch (e) {
      throw new QuoteError("reverted", `${token.symbol} quote failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}
