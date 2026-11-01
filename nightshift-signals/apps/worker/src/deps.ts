import type { Embedder, EquityPrintSource, NewsSource, Notifier, QuoteSource, RegistrySource, TextToSpeech } from "@nightshift-signals/adapters";
import type { JsonModel } from "@nightshift-signals/ai";
import type { Bus, PriceCache } from "@nightshift-signals/core";
import type { Taxonomy } from "@nightshift-signals/core/taxonomy";
import type { Ledger } from "@nightshift-signals/chain";
import type { Db, FairValueReader } from "@nightshift-signals/db";
import type { ExitPricer } from "./stages/grade";

export interface PipelineConfig {
  /** Each leg is quoted at this size; published so slippage is honest. */
  refSizeUsdg: string;
  /** Small quote used as the mid reference for slippage. */
  probeSizeUsdg: string;
  maxSlipBps: number;
  minPoolLiquidityUsdg: number;
  driftAlertBps: number;
  /** Past this, a commit is published with a pending flag and the signed hash. */
  commitWaitMs: number;
}

export const DEFAULT_CONFIG: PipelineConfig = {
  refSizeUsdg: "1000",
  probeSizeUsdg: "10",
  maxSlipBps: 80,
  minPoolLiquidityUsdg: 50_000,
  driftAlertBps: 150,
  commitWaitMs: 20_000,
};

/** Everything a stage touches from the outside world. Swapped for fakes in tests and replay. */
export interface Deps {
  db: Db;
  bus: Bus;
  embedder: Embedder;
  news: NewsSource;
  model: JsonModel;
  taxonomy: () => Taxonomy;
  fairValue: FairValueReader;
  quotes: QuoteSource;
  registry: RegistrySource;
  prices: PriceCache;
  /** Official ETF prints; null until an equities vendor is wired up. */
  equityPrints: EquityPrintSource | null;
  config: PipelineConfig;
  ledger: Ledger;
  notifiers: Notifier[];
  exits: ExitPricer;
  /** Morning brief audio; null = the browser reads the script. */
  tts?: TextToSpeech | null;
  /** Public web origin, for links in alerts. */
  appUrl: string;
  now: () => Date;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}
