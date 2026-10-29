/** One-sentence answers for the "?" next to numbers on the site. Kept plain: these are for first-time visitors. */
export const TIPS = {
  fairValue: "What the token is worth right now by Nightshift's estimate, even when Wall Street is closed, from futures and world markets.",
  confidence: "How sure Nightshift is about that price, out of 100. It drops the longer markets stay closed or when its signals disagree.",
  lastClose: "The price when Wall Street last closed. Most price feeds stay stuck here all night and weekend.",
  drift: "How far the fair value has moved from the last closing price since the market shut.",
  health: "What your collateral can support divided by what you owe. Above 1 is safe; below 1, part of the loan can be liquidated.",
  borrowLimit: "The most you can borrow against this collateral right now. It shrinks when the price falls or confidence is low.",
  liquidationPrice: "If the token's price falls to this, your loan's health reaches 1 and part of it can be liquidated.",
} as const;
export type TipKey = keyof typeof TIPS;
