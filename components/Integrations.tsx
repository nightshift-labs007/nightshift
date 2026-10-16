/* eslint-disable @next/next/no-img-element */
import { DEPLOYMENT, addrUrl } from "@/lib/chain";

type Integration = {
  name: string;
  handle: string;
  logo: string;
  light?: boolean; // dark mark: show it on a light tile
  role: string;
  uses: string;
  matters: string;
  proof: { href: string; label: string; external?: boolean };
};

const spyAdapter = DEPLOYMENT.tokens?.SPY?.adapter;

const INTEGRATIONS: Integration[] = [
  {
    name: "Harmonic",
    handle: "HarmonicMath",
    logo: "/logos/harmonic.svg",
    light: true,
    role: "Formal verification",
    uses: "Harmonic's Aristotle checked 24 Lean 4 proofs of Nightshift's core rules: when a loan can be liquidated, how much the Guardian sells, and how far the Oracle's price and confidence can move.",
    matters: "Lending code fails at the edges. Proofs cover every input, not just the cases a test happened to try, so “a healthy loan can't be liquidated” is a theorem rather than a promise.",
    proof: { href: "/transparency#verified", label: "See the 24 proofs" },
  },
  {
    name: "Morpho",
    handle: "Morpho",
    logo: "/logos/morpho.png",
    role: "Lending standard",
    uses: "The Vault follows Morpho Blue's rules (health factor, LLTV, liquidation incentive), and Nightshift publishes Morpho-compatible price oracles on Base that refuse prices more than a day old.",
    matters: "Any Morpho market can price tokenized ETFs with Nightshift's overnight fair value instead of a frozen close, so loans stay fairly priced while Wall Street is shut.",
    proof: spyAdapter ? { href: addrUrl(spyAdapter), label: "dSPY Morpho oracle on Base", external: true } : { href: "/docs#morpho", label: "How it works" },
  },
  {
    name: "Algorand",
    handle: "Algorand",
    logo: "/logos/algorand.svg",
    role: "Public track record",
    uses: "Every weekday before the open, Nightshift's predicted prices are hashed and written to Algorand. After the bell they're graded against the real open.",
    matters: "A track record you can edit afterwards is worthless. Locking each call on-chain before the market opens makes the accuracy record tamper-proof, losing days included.",
    proof: { href: "/transparency#ledger", label: "See the locked predictions" },
  },
  {
    name: "Sentora",
    handle: "SentoraHQ",
    logo: "/logos/sentora.png",
    role: "Yield for idle USDG",
    uses: "The Earn panel shows a Sentora PYUSD vault live: current yield, size and history, with a link to deposit on Sentora's own site.",
    matters: "Borrowed or idle stablecoins shouldn't sit still. Sentora gives a curated, protected RWA rate, while Nightshift never touches the funds.",
    proof: { href: "/#earn", label: "See the live vault" },
  },
  {
    name: "ZKProof",
    handle: "zkproof",
    logo: "/logos/zkproof.png",
    light: true,
    role: "Zero-knowledge standards",
    uses: "Cloak proves a loan is solvent at the Oracle price with a Groth16 proof, a proof system covered by the ZKProof community's open standards work. It is checked by the server and by a contract on Base.",
    matters: "Public loans show exactly where a liquidation would trigger. Cloak proves a loan is safe without revealing its size or liquidation level, so large borrowers aren't a target.",
    proof: { href: "/proof", label: "Generate a proof" },
  },
];

/** "Built with" grid on the landing page: each integration, what Nightshift uses it for, and why it matters. */
export function Integrations() {
  return (
    <>
      <div className="integrations">
        {INTEGRATIONS.map((x) => (
          <article key={x.name} className="integration">
            <header className="integration-top">
              <span className={`integration-logo ${x.light ? "light" : ""}`}>
                <img src={x.logo} alt={`${x.name} logo`} width={40} height={40} />
              </span>
              <div>
                <h3>{x.name}</h3>
                <a className="integration-handle" href={`https://x.com/${x.handle}`} target="_blank" rel="noopener noreferrer">
                  @{x.handle}
                </a>
              </div>
              <span className="integration-role">{x.role}</span>
            </header>
            <p className="integration-label">How Nightshift uses it</p>
            <p>{x.uses}</p>
            <p className="integration-label">Why it matters</p>
            <p>{x.matters}</p>
            <a className="integration-go" href={x.proof.href} {...(x.proof.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {x.proof.label} {x.proof.external ? "↗" : "→"}
            </a>
          </article>
        ))}
      </div>
      <p className="modules-note">
        These are technical integrations Nightshift built on public protocols and tools. Logos belong to their owners and do not imply
        endorsement or partnership.
      </p>
    </>
  );
}
