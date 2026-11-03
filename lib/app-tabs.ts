export type AppTab = "prices" | "borrow" | "stack" | "predict";

/**
 * Which App tab a URL opens: #stack → Stack; #predict → Predict; #vault, #guardian, #borrow or a borrow link
 * (?try, ?loan) → Borrow; else Prices.
 */
export const appTab = (hash: string, borrowLink = false): AppTab =>
  hash === "#stack" ? "stack" : hash === "#predict" ? "predict" : borrowLink || ["#vault", "#guardian", "#borrow"].includes(hash) ? "borrow" : "prices";
