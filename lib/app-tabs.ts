export type AppTab = "prices" | "borrow" | "stack";

/** Which App tab a URL opens: #stack → Stack; #vault, #guardian, #borrow or a borrow link (?try, ?loan) → Borrow; else Prices. */
export const appTab = (hash: string, borrowLink = false): AppTab =>
  hash === "#stack" ? "stack" : borrowLink || ["#vault", "#guardian", "#borrow"].includes(hash) ? "borrow" : "prices";
