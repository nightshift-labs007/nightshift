import { DEPLOYMENT, addrUrl } from "@/lib/chain";

/** What each page of the site is for, shown in the Explore panel. */
export const PAGES = [
  { href: "/app", label: "App", icon: "M4 9h16v10H4zM8 9V6a4 4 0 0 1 8 0v3", what: "Borrow against ETF tokens and switch on Guardian protection, or set up Stack to buy gold and silver automatically at a fair price." },
  { href: "/oracle", label: "Oracle", icon: "M4 18 9 12l4 3 7-9M15 6h5v5", what: "Live overnight fair value and confidence for SPY, QQQ, GLD and IBIT, with charts, the API and the morning shift report." },
  { href: "/proof", label: "Proof", icon: "M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 0 0 5", what: "Make a zero-knowledge proof that a loan is solvent without revealing it, and verify it on-chain." },
  { href: "/transparency", label: "Transparency", icon: "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6zM9 12l2 2 4-4", what: "The 24 machine-checked proofs, the Algorand prediction ledger, and every contract address." },
  { href: "/transactions", label: "Transactions", icon: "M4 8h13l-3-3M20 16H7l3 3", what: "Every transaction in one list: loans, Guardian saves, Oracle updates and Algorand stamps, each linked to its explorer." },
  { href: "/docs", label: "Docs", icon: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4", what: "Straight answers on how the oracle, Vault, Guardian and Cloak work, and what's still a demo." },
  { href: "/leaderboard", label: "Leaderboard", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3", what: "Every wallet that joined or used Nightshift, ranked by what it has done on-chain." },
  { href: "/profile", label: "Profile", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6", what: "Your name, email and links, and the points you've collected. Your wallet is your login." },
  { href: "/#stocks", label: "Stocks", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2", what: "The world's biggest stocks, priced after the bell by the same engine." },
  { href: "/#earn", label: "Earn", icon: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7", what: "A live view of a Sentora vault where idle USDG could earn a protected rate." },
] as const;

export type Integration = {
  name: string;
  handle: string;
  logo: string;
  light?: boolean; // dark mark: show it on a light tile
  role: string;
  short: string; // one line for the Explore panel
  uses: string;
  matters: string;
  page: { href: string; label: string }; // where it shows up on the site
  proof: { href: string; label: string; external?: boolean };
};

const spyAdapter = DEPLOYMENT.tokens?.SPY?.adapter;

export const INTEGRATIONS: Integration[] = [
  {
    name: "Harmonic",
    handle: "HarmonicMath",
    logo: "/logos/harmonic.svg",
    light: true,
    role: "Formal verification",
    short: "Aristotle machine-checked 24 Lean 4 proofs of the lending, Guardian and Oracle rules.",
    uses: "Harmonic's Aristotle checked 24 Lean 4 proofs of Nightshift's core rules: when a loan can be liquidated, how much the Guardian sells, and how far the Oracle's price and confidence can move.",
    matters: "Lending code fails at the edges. Proofs cover every input, not just the cases a test happened to try, so “a healthy loan can't be liquidated” is a theorem rather than a promise.",
    page: { href: "/transparency#verified", label: "Transparency" },
    proof: { href: "/transparency#verified", label: "See the 24 proofs" },
  },
  {
    name: "Morpho",
    handle: "Morpho",
    logo: "/logos/morpho.png",
    role: "Lending standard",
    short: "The Vault follows Morpho Blue's rules, and Morpho-compatible price oracles are live on Base.",
    uses: "The Vault follows Morpho Blue's rules (health factor, LLTV, liquidation incentive), and Nightshift publishes Morpho-compatible price oracles on Base that refuse prices more than a day old.",
    matters: "Any Morpho market can price tokenized ETFs with Nightshift's overnight fair value instead of a frozen close, so loans stay fairly priced while Wall Street is shut.",
    page: { href: "/app", label: "App" },
    proof: spyAdapter ? { href: addrUrl(spyAdapter), label: "dSPY Morpho oracle on Base", external: true } : { href: "/docs#morpho", label: "How it works" },
  },
  {
    name: "Algorand",
    handle: "Algorand",
    logo: "/logos/algorand.svg",
    role: "Public track record",
    short: "Every pre-open prediction is locked on Algorand before the bell; leaderboard joins are recorded there too.",
    uses: "Every weekday before the open, Nightshift's predicted prices are hashed and written to Algorand. After the bell they're graded against the real open. Leaderboard joins are recorded there too.",
    matters: "A track record you can edit afterwards is worthless. Locking each call on-chain before the market opens makes the accuracy record tamper-proof, losing days included.",
    page: { href: "/transparency#ledger", label: "Transparency" },
    proof: { href: "/transparency#ledger", label: "See the locked predictions" },
  },
  {
    name: "Sentora",
    handle: "SentoraHQ",
    logo: "/logos/sentora.png",
    role: "Yield for idle USDG",
    short: "A live view of a Sentora PYUSD vault, with deposits on Sentora's own site.",
    uses: "The Earn panel shows a Sentora PYUSD vault live: current yield, size and history, with a link to deposit on Sentora's own site.",
    matters: "Borrowed or idle stablecoins shouldn't sit still. Sentora gives a curated, protected RWA rate, while Nightshift never touches the funds.",
    page: { href: "/#earn", label: "Earn" },
    proof: { href: "/#earn", label: "See the live vault" },
  },
  {
    name: "ZKProof",
    handle: "zkproof",
    logo: "/logos/zkproof.png",
    light: true,
    role: "Zero-knowledge standards",
    short: "Cloak's Groth16 solvency proofs follow the proof system covered by ZKProof's open standards work.",
    uses: "Cloak proves a loan is solvent at the Oracle price with a Groth16 proof, a proof system covered by the ZKProof community's open standards work. It is checked by the server and by a contract on Base.",
    matters: "Public loans show exactly where a liquidation would trigger. Cloak proves a loan is safe without revealing its size or liquidation level, so large borrowers aren't a target.",
    page: { href: "/proof", label: "Proof" },
    proof: { href: "/proof", label: "Generate a proof" },
  },
];
