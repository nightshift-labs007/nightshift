// Test fixtures shared across packages. Not for production code.
import type { Basket } from "./schemas/basket";

export const SAMPLE_EVENT_ID = "evt_01JB8Z3Q5X6C7V8B9N0M1K2J3H";

/** The deck's example basket: shipping risk lifts oil and gold. Addresses are placeholders. */
export function sampleBasket(overrides: Partial<Basket> = {}): Basket {
  return {
    id: "bkt_20261021_0214_a",
    event_id: SAMPLE_EVENT_ID,
    created_at: "2026-10-21T06:14:00.000Z",
    published_at: null,
    thesis: "Shipping risk lifts oil, gold",
    thesis_i18n: {},
    why_chain: [],
    direction: "long",
    legs: [
      leg("XLE", "0x1111111111111111111111111111111111111111", 0.45, "92.150000"),
      leg("GLD", "0x2222222222222222222222222222222222222222", 0.3, "241.800000"),
      leg("ITA", "0x3333333333333333333333333333333333333333", 0.25, "156.420000"),
    ],
    confidence: 0.62,
    confidence_calibrated: null,
    horizon: "next_open",
    max_slip_bps: 80,
    model_version: "claude-sonnet-5-5",
    prompt_version: "map-v1",
    analog_event_ids: [],
    canonical_hash: null,
    commit_tx: null,
    status: "draft",
    void_reason: null,
    ...overrides,
  };
}

function leg(symbol: string, address: string, weight: number, price: string) {
  return {
    token_symbol: symbol,
    token_address: address,
    underlying_ticker: symbol,
    weight,
    entry_quote_price: price,
    entry_quote_size_usdg: "1000",
    est_slippage_bps: 35,
    fair_value: price,
    fv_gap_bps: 0,
  };
}
