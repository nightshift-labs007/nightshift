// Deep links into the user's own wallet or DEX. We never hold funds; the user signs.

export interface SwapLinkInput {
  /** Uniswap web app chain slug for Robinhood Chain. Confirm against current Uniswap docs. */
  chainSlug: string;
  usdgAddress: string;
  tokenAddress: string;
  usdgAmount: string;
}

/** Prefilled USDG → token swap in the Uniswap web app. */
export function uniswapSwapUrl(i: SwapLinkInput): string {
  const q = new URLSearchParams({
    chain: i.chainSlug,
    inputCurrency: i.usdgAddress,
    outputCurrency: i.tokenAddress,
    exactAmount: i.usdgAmount,
    exactField: "input",
  });
  return `https://app.uniswap.org/swap?${q.toString()}`;
}

/** Per-leg USDG amounts for a basket of `total` USDG, rounded down to cents so the sum never exceeds it. */
export function legAmounts(total: number, weights: number[]): string[] {
  return weights.map((w) => (Math.floor(total * w * 100) / 100).toFixed(2));
}

/** Countries that may not see trade links. Stock Tokens are not available to US persons. */
export const BLOCKED_COUNTRIES = new Set(["US"]);

/** Edge geo header → may this request see trade links? Unknown country is blocked in live mode. */
export function tradeLinksAllowed(country: string | null | undefined, opts: { allowUnknown: boolean }): boolean {
  if (!country) return opts.allowUnknown;
  return !BLOCKED_COUNTRIES.has(country.toUpperCase());
}
