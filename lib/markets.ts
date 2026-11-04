"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Market selector (plan §3): a preference that decides which tokens lead, which legal text shows and which features are on.
 * It is not an eligibility check. Each market has its own switch, so one market's problem can't take down another.
 */
export type MarketId = "usa" | "global";
export type Readiness = "live" | "data" | "soon";

export type Market = {
  id: MarketId;
  name: string;
  tagline: string;
  /** Oracle tokens this market leads with; the rest stay visible, after them */
  tokens: string[];
  features: { prices: Readiness; alerts: Readiness; lending: Readiness };
  legal: string;
  next: string;
};

export const MARKETS: Market[] = [
  {
    id: "usa",
    name: "USA",
    tagline: "Tokenized US ETFs (SPY, QQQ), priced overnight, with loans protected by the Guardian.",
    tokens: ["SPY", "QQQ", "DIA", "IWM", "SMH", "TLT"],
    features: { prices: "live", alerts: "soon", lending: "data" },
    legal:
      "Tokenized US ETFs, not the shares themselves. Stock Tokens are not available to US persons. Lending runs on unaudited demo contracts with tokens that have no value; real lending waits for an audit and legal opinions.",
    next: "Next: an audited, capped pilot market.",
  },
  {
    id: "global",
    name: "Global ETFs",
    tagline: "Gold, silver and Bitcoin ETF tokens. Later, European and Asian index tokens.",
    tokens: ["GLD", "SLV", "IBIT", "ETHA", "GDX", "USO"],
    features: { prices: "live", alerts: "soon", lending: "data" },
    legal:
      "Each asset has its own price model and track record. Lending runs on unaudited demo contracts with tokens that have no value. Not investment advice.",
    next: "Next: European and Asian index tokens, each with its own graded record.",
  },
];

export const READINESS_LABEL: Record<Readiness, string> = { live: "Live", data: "Demo only", soon: "Coming soon" };
export const marketById = (id: string | null | undefined) => MARKETS.find((m) => m.id === id) ?? null;

const KEY = "ns.market";
const EVENT = "ns:market";

/** The visitor's chosen market (null until they pick), kept in localStorage and synced across components and tabs. */
export function useMarket(): [Market | null, (id: MarketId) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      try {
        setId(localStorage.getItem(KEY));
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const choose = useCallback((next: MarketId) => {
    setId(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [marketById(id), choose];
}

/** Orders items so the market's own tokens come first, in the market's order. */
export function marketFirst<T>(items: T[], token: (x: T) => string, market: Market | null): T[] {
  if (!market) return items;
  const rank = (x: T) => {
    const i = market.tokens.indexOf(token(x));
    return i === -1 ? market.tokens.length : i;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
