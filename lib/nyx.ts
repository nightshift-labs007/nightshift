/**
 * Nyx, Nightshift's voice assistant: turns what someone said into an intent. Plain rules, no AI model: fast, free,
 * and it never makes things up. Kept free of imports so it can be unit-tested on its own (scripts/test-nyx.mjs).
 */
export type Token = "SPY" | "QQQ" | "GLD" | "IBIT";
export type Page = "home" | "app" | "guardian" | "oracle" | "proof" | "transparency" | "docs" | "leaderboard" | "profile" | "stocks" | "earn";
export type Topic =
  | "nightshift" | "health" | "guardian" | "oracle" | "confidence" | "cloak" | "ledger" | "liquidation" | "proofs"
  | "morpho" | "sentora" | "points" | "vault" | "demo" | "beta";
export type Intent =
  | { kind: "price"; token?: Token }
  | { kind: "movers" }
  | { kind: "market" }
  | { kind: "confidence"; token?: Token }
  | { kind: "accuracy" }
  | { kind: "go"; page: Page }
  | { kind: "explain"; topic: Topic }
  | { kind: "loan" }
  | { kind: "points" }
  | { kind: "leaders" }
  | { kind: "money" } // borrow, repay, deposit, withdraw: voice never moves funds
  | { kind: "wallet" }
  | { kind: "tour" }
  | { kind: "alerts"; on: boolean }
  | { kind: "help" }
  | { kind: "who" }
  | { kind: "greet" }
  | { kind: "thanks" }
  | { kind: "time" }
  | { kind: "stop" }
  | { kind: "unknown"; text: string };

export const PAGE_HREF: Record<Page, string> = {
  home: "/", app: "/app", guardian: "/app#guardian", oracle: "/oracle", proof: "/proof", transparency: "/transparency",
  docs: "/docs", leaderboard: "/leaderboard", profile: "/profile", stocks: "/#stocks", earn: "/#earn",
};
export const PAGE_NAME: Record<Page, string> = {
  home: "the home page", app: "the App", guardian: "the Guardian", oracle: "the Oracle", proof: "the Proof page",
  transparency: "Transparency", docs: "the Docs", leaderboard: "the leaderboard", profile: "your profile", stocks: "the stock board", earn: "Earn",
};
export const TOKEN_NAME: Record<Token, string> = { SPY: "the S&P 500 ETF", QQQ: "the Nasdaq 100 ETF", GLD: "the gold ETF", IBIT: "the bitcoin ETF" };

/** Spoken explanations: short, accurate, and nothing the site can't back up. */
export const EXPLAIN: Record<Topic, string> = {
  nightshift:
    "Nightshift prices tokenized ETFs after Wall Street closes. Stock markets shut at 4pm, but these tokens trade all night, so I estimate what they're really worth from futures, world markets and sentiment. You can borrow against them, and the Guardian protects your loan while you sleep.",
  health:
    "Your health factor is what your collateral can support, divided by what you owe. Above 1 you're safe. Below 1, anyone can liquidate part of your loan. Keep it comfortably above 1, and switch on the Guardian for extra cover.",
  guardian:
    "The Guardian watches your loan around the clock. Pick a trigger, say 1.10, and a target, say 1.40. If the overnight price drags your health below the trigger, it uses just enough collateral to repay debt and lift you back to the target, before liquidation can happen. If selling can't help, it only alerts you.",
  oracle:
    "My fair value blends four signals: overnight futures or bitcoin, Asian and European markets, short-term momentum, and market sentiment. Each is weighted by how accurate it has been at past market opens, and the result is pushed on-chain every ten minutes.",
  confidence:
    "Confidence runs from 35 to 98. It falls the longer markets stay closed and when my signals disagree, and it's capped during big overnight moves. Lower confidence means you can borrow less, so the Vault stays careful when I'm less sure.",
  cloak:
    "Cloak proves your loan is safe without revealing it. A zero-knowledge proof shows your collateral covers your debt at my price, without exposing the loan's size or liquidation level. It's checked by the server and by a contract on Base.",
  ledger:
    "Every weekday before the opening bell, my predictions are fingerprinted and written to Algorand, then graded against the real open. Nobody, including the Nightshift team, can edit them afterwards, losing days included.",
  liquidation:
    "Liquidation happens when health drops below 1. Someone repays part of your debt and takes collateral plus a bonus of up to 15 percent. Each token's LLTV, 77 percent for SPY, QQQ and gold and 62.5 percent for bitcoin, sets where that line is.",
  proofs:
    "Twenty-four of Nightshift's safety rules are proven mathematically in Lean 4 and checked by Harmonic's Aristotle. For example: a healthy loan can never be liquidated, and the Guardian never sells more than you own. The proofs are public on GitHub.",
  morpho:
    "The Vault follows Morpho Blue's lending rules, and Nightshift publishes Morpho-compatible price feeds on Base, so any Morpho market can use my overnight prices instead of a frozen close.",
  sentora:
    "The Earn section shows a live Sentora vault where idle stablecoins could earn a protected rate. Deposits happen on Sentora's own site. Nightshift never touches the funds.",
  points:
    "You earn 10 points for joining the leaderboard, 20 for each token you deposit, 30 for an open loan, and 25 for switching on the Guardian. They live on public chains, so nobody can tamper with the rankings. They're demo points with no money value.",
  vault:
    "The Vault lets you deposit ETF tokens as collateral and borrow dUSDG against them. Your limit comes from my live overnight price, not a stale close. It runs on Base with demo tokens that have no value, and it hasn't been audited.",
  demo:
    "Everything here uses demo tokens with no value. Connect a wallet on Base and press Get demo tokens in the App, or try the paper account without any wallet at all.",
  beta:
    "Beta is how strongly an ETF moves with its futures overnight. I measure it from past nights, then pull it gently toward one so a short history can't fool me. If the fit is weak, I simply use one.",
};

const TOKENS: [RegExp, Token][] = [
  [/\b(spy|s ?and ?p|s&p|sp ?500|s p 500|standard and poors?)\b/, "SPY"],
  [/\b(qqq|nasdaq|triple q|cubes)\b/, "QQQ"],
  [/\b(gld|gold)\b/, "GLD"],
  [/\b(ibit|bitcoin|btc|i ?bit|eye bit)\b/, "IBIT"],
];
export const findToken = (t: string): Token | undefined => TOKENS.find(([re]) => re.test(t))?.[1];

const PAGES: [RegExp, Page][] = [
  [/\b(guardian)\b/, "guardian"],
  [/\b(leader ?board|leaders|rankings?)\b/, "leaderboard"],
  [/\b(profile|my account)\b/, "profile"],
  [/\b(oracle|prices? page|live prices)\b/, "oracle"],
  [/\b(proofs?|cloak|zero knowledge)\b/, "proof"],
  [/\b(transparency|ledger|contracts)\b/, "transparency"],
  [/\b(docs|documentation|faq)\b/, "docs"],
  [/\b(stocks?|stock board)\b/, "stocks"],
  [/\b(earn|yield|sentora)\b/, "earn"],
  [/\b(app|vault|borrow page|dashboard)\b/, "app"],
  [/\b(home|start|main page|landing)\b/, "home"],
];

const TOPICS: [RegExp, Topic][] = [
  [/\b(health ?factor|health)\b/, "health"],
  [/\b(guardian|auto ?protect)/, "guardian"],
  [/\b(confidence|conf)\b/, "confidence"],
  [/\b(cloak|zero knowledge|zk|solvency proof)/, "cloak"],
  [/\b(ledger|algorand|track record)\b/, "ledger"],
  [/\b(liquidat\w*|lltv|liquidation)\b/, "liquidation"],
  [/\b(proofs?|lean|harmonic|aristotle|formal)\b/, "proofs"],
  [/\b(morpho)\b/, "morpho"],
  [/\b(sentora|earn|yield)\b/, "sentora"],
  [/\b(points?|scor\w*)\b/, "points"],
  [/\b(beta|blume)\b/, "beta"],
  [/\b(fair value|oracle|price model|how do you price|signals?|trust (your|the|this) prices?)\b/, "oracle"],
  [/\b(vault|borrowing|lending)\b/, "vault"],
  [/\b(demo|test) tokens?\b|\bfaucet\b/, "demo"],
  [/\b(nightshift|night shift|this (site|project|app)|you guys)\b/, "nightshift"],
];

/** Lowercase, drop punctuation, and join letters speech engines split up ("q q q" → "qqq"). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9&.%\s]/g, " ")
    .replace(/\bq\s+q\s+q\b/g, "qqq")
    .replace(/\bg\s+l\s+d\b/g, "gld")
    .replace(/\bs\s+p\s+y\b/g, "spy")
    .replace(/\bi\s+b\s+i\s+t\b/g, "ibit")
    .replace(/\bnight shift\b/g, "nightshift")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

export function parse(raw: string): Intent {
  const t = normalize(raw).replace(/^(hey |hi |ok |okay )?(nyx|nix|nicks|knicks)[, ]*/, "").trim();
  if (!t) return { kind: "help" };

  if (has(t, /^(stop|quiet|shut up|be quiet|silence|cancel|never ?mind)\b/)) return { kind: "stop" };
  if (has(t, /\b(alerts?|notifications?|warn me|heads up)\b/)) {
    if (has(t, /\b(off|stop|disable|mute|no more|dont|do not)\b/)) return { kind: "alerts", on: false };
    if (has(t, /\b(on|start|enable|turn|switch|warn me|keep me)\b/)) return { kind: "alerts", on: true };
  }
  if (has(t, /\b(what can you do|help|commands|what do you do|how do i use you)\b/)) return { kind: "help" };
  if (has(t, /\b(who are you|your name|what are you)\b/)) return { kind: "who" };
  if (has(t, /^(thanks|thank you|cheers|great|awesome|nice|perfect)\b/)) return { kind: "thanks" };
  if (has(t, /\b(what time|the time)\b/)) return { kind: "time" };
  if (has(t, /\b(tour|walk me through|show me around|guide|getting started|im new|i am new|new here)\b/)) return { kind: "tour" };
  if (has(t, /\b(connect|link)\b.*\bwallet\b/)) return { kind: "wallet" };

  // money moves: never done by voice
  if (has(t, /\b(borrow|repay|deposit|withdraw|lend|swap|buy|sell|liquidate)\b/) && !has(t, /\b(what|how|why|explain|mean)\b/)) return { kind: "money" };

  // the user's own account
  if (has(t, /\b(my|me|i)\b/) && has(t, /\b(loans?|positions?|health|safe|debt|collateral)\b/)) return { kind: "loan" };
  if (has(t, /\b(my|i)\b/) && has(t, /\b(points?|rank|score|place|position on the leaderboard)\b/)) return { kind: "points" };

  // navigation
  if (has(t, /\b(go|go to|take me|open|show me|navigate|bring up|switch to|jump to)\b/)) {
    const p = PAGES.find(([re]) => re.test(t));
    if (p) return { kind: "go", page: p[1] };
  }

  if (has(t, /\b(accura\w*|track record|how good|how right|hit rate|graded)\b/) && !has(t, /\b(ledger|algorand)\b/)) return { kind: "accuracy" };

  // explanations
  if (has(t, /\b(what is|whats|what are|what does|explain|tell me about|how does|how do|why|define|meaning|mean|trust)\b/)) {
    const topic = TOPICS.find(([re]) => re.test(t));
    if (topic && !(topic[1] === "oracle" && findToken(t) && has(t, /\b(worth|price|trading)\b/))) return { kind: "explain", topic: topic[1] };
  }

  // market data
  if (has(t, /\b(who.?s|top|best|leading|winning)\b.*\b(leader ?board|players?|users?)\b|\bleader ?board\b/)) return { kind: "leaders" };
  if (has(t, /\b(accura\w*|track record|how good|how right|hit rate|graded)\b/)) return { kind: "accuracy" };
  if (has(t, /\b(market|nyse|wall street|exchange)\b/) && has(t, /\b(open|closed|close|status|hours)\b/)) return { kind: "market" };
  if (has(t, /\b(moved|moving|movers?|biggest|most|winners?|losers?)\b/)) return { kind: "movers" };
  if (has(t, /\b(confidence|confident|sure|certain)\b/)) return { kind: "confidence", token: findToken(t) };
  const token = findToken(t);
  if (token || has(t, /\b(price|prices|worth|trading|quote|value|how much|markets?)\b/)) return { kind: "price", token };

  if (has(t, /^(hi|hey|hello|good (morning|evening|afternoon|night)|yo|sup)\b/)) return { kind: "greet" };
  const topic = TOPICS.find(([re]) => re.test(t));
  if (topic) return { kind: "explain", topic: topic[1] };
  return { kind: "unknown", text: raw };
}

export const SUGGESTIONS = ["What's SPY worth?", "How's my loan?", "What is the Guardian?", "Take me to the leaderboard", "Is the market open?"];

export const HELP =
  "I can tell you what SPY, QQQ, gold or bitcoin ETFs are worth right now, check your loan and your points, explain how anything here works, and take you to any page. Try: what's gold worth, how's my loan, or take me to the leaderboard. I can't move money: borrowing and repaying always happen in your wallet.";
