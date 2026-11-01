import type { RegistryEntry } from "./types";
import { SimMarket } from "./sim";

/**
 * Local-only token list. Placeholder addresses (0x…01, 0x…02) are NOT Robinhood Chain contracts;
 * real addresses come from the official Stock Token registry.
 */
const ROWS: [symbol: string, name: string, price: number, liquidity: number, proxy: string][] = [
  ["SPY", "SPDR S&P 500 ETF", 671, 2_000_000, "ES"],
  ["QQQ", "Invesco QQQ", 612, 1_500_000, "NQ"],
  ["XLE", "Energy Select Sector SPDR", 88, 400_000, "CL+ES"],
  ["USO", "United States Oil Fund", 74, 150_000, "CL"],
  ["GLD", "SPDR Gold Shares", 398, 900_000, "GC"],
  ["ITA", "iShares US Aerospace & Defense", 205, 250_000, "ES"],
  ["SMH", "VanEck Semiconductor ETF", 342, 700_000, "NQ"],
  ["TLT", "iShares 20+ Year Treasury Bond", 91, 300_000, "ZN"],
  ["XLF", "Financial Select Sector SPDR", 53, 300_000, "ES"],
  ["FXI", "iShares China Large-Cap", 39, 120_000, "ES"],
  ["IBIT", "iShares Bitcoin Trust", 61, 800_000, "BTC"],
  ["XLV", "Health Care Select Sector SPDR", 141, 200_000, "ES"],
  ["XBI", "SPDR S&P Biotech", 98, 30_000, "ES"],
];

export const SIM_REGISTRY: (RegistryEntry & { price: number; liquidity: number })[] = ROWS.map(([symbol, name, price, liquidity, proxy], i) => ({
  symbol,
  address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
  underlying_ticker: symbol,
  name,
  decimals: 18,
  pool_address: `0x${(i + 0x101).toString(16).padStart(40, "0")}`,
  pool_fee: 3000,
  proxy,
  active: true,
  price,
  liquidity,
}));

export function localSimMarket() {
  return new SimMarket(SIM_REGISTRY, { ES: 6800, NQ: 25_000, CL: 72, GC: 4100, ZN: 112, BTC: 108_000 });
}
