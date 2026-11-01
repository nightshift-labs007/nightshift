import type { Basket } from "./schemas/basket";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Canonical JSON for hashing: keys sorted, no whitespace, every number as a string.
 * Non-integer numbers are rejected so no language's float formatting can change the hash;
 * format them with a fixed number of decimals before calling (see basketCommitPayload).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$"));
}

function normalize(value: unknown, path: string): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`canonicalJson: ${path} is ${value}; format non-integers as fixed-decimal strings first`);
    }
    return String(value);
  }
  if (Array.isArray(value)) return value.map((v, i) => normalize(v, `${path}[${i}]`));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value} at ${path}`);
}

export const WEIGHT_DECIMALS = 6;
/** Matches numeric(38,18): "92.15" and "92.150000" must hash the same. */
export const MONEY_DECIMALS = 18;
export const CONFIDENCE_DECIMALS = 4;

/**
 * The part of a basket that is hashed and committed onchain. Only fields known before
 * anyone sees the basket; publish time, status, calibration and translations come later.
 */
export function basketCommitPayload(b: Basket) {
  return {
    id: b.id,
    event_id: b.event_id,
    created_at: b.created_at,
    thesis: b.thesis,
    direction: b.direction,
    legs: b.legs.map((l) => ({
      token_symbol: l.token_symbol,
      token_address: l.token_address.toLowerCase(),
      underlying_ticker: l.underlying_ticker,
      weight: l.weight.toFixed(WEIGHT_DECIMALS),
      entry_quote_price: fixedDecimal(l.entry_quote_price),
      entry_quote_size_usdg: fixedDecimal(l.entry_quote_size_usdg),
      est_slippage_bps: l.est_slippage_bps,
      fair_value: fixedDecimal(l.fair_value),
      fv_gap_bps: l.fv_gap_bps,
    })),
    confidence: b.confidence.toFixed(CONFIDENCE_DECIMALS),
    horizon: b.horizon,
    max_slip_bps: b.max_slip_bps,
    model_version: b.model_version,
    prompt_version: b.prompt_version,
    analog_event_ids: b.analog_event_ids,
    // Added after launch: included only when present, so earlier baskets hash exactly as committed.
    ...(b.why_chain.length ? { why_chain: b.why_chain } : {}),
  };
}

/** The exact string whose keccak256 becomes canonical_hash (hashing lives in packages/chain). */
export function basketCanonicalJson(b: Basket): string {
  return canonicalJson(basketCommitPayload(b));
}

/** Pads a decimal string to exactly `places` fractional digits, without going through floats. */
export function fixedDecimal(value: string, places = MONEY_DECIMALS): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`fixedDecimal: not a decimal string: ${value}`);
  const [, sign, int, frac = ""] = m;
  if (frac.length > places) throw new Error(`fixedDecimal: ${value} has more than ${places} decimals`);
  const normInt = int!.replace(/^0+(?=\d)/, "");
  const out = `${normInt}.${frac.padEnd(places, "0")}`;
  return /^0\.0+$/.test(out) ? out : `${sign}${out}`;
}
