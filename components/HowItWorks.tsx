/* eslint-disable @next/next/no-img-element */
import { isDeployed } from "@/lib/chain";
import { verifiedCount } from "./Verified";

const ONCHAIN = isDeployed ? "Live on testnet" : "Testnet-ready";

type Logo = { name: string; src: string; rel: string };

const MODULES: { n: string; name: string; href: string; status: string; tone: string; what: string; icon: string; logos: Logo[] }[] = [
  {
    n: "01",
    name: "Oracle",
    href: "#oracle",
    status: "Live",
    tone: "live",
    what: "Prices SPY, QQQ, gold and Bitcoin ETF tokens around the clock from overnight futures, world markets and sentiment, with a confidence score.",
    icon: "M4 18 9 12l4 3 7-9M15 6h5v5",
    logos: [
      { name: "Robinhood Chain", src: "/logos/robinhood.svg", rel: "Tokens priced" },
      { name: "Claude", src: "/logos/claude.svg", rel: "Planned news agent" },
    ],
  },
  {
    n: "02",
    name: "Vault",
    href: "#vault",
    status: ONCHAIN,
    tone: "paper",
    what: "Deposit ETF tokens and borrow USDG against them. Limits come from the Oracle's price, not a frozen close.",
    icon: "M4 9h16v10H4zM8 9V6a4 4 0 0 1 8 0v3M12 13v2",
    logos: [
      { name: "Morpho", src: "/logos/morpho.png", rel: "Lending rules" },
      { name: "Robinhood Chain", src: "/logos/robinhood.svg", rel: "Network" },
      { name: "Aave", src: "/logos/aave.svg", rel: "Planned venue" },
    ],
  },
  {
    n: "03",
    name: "Guardian",
    href: "#guardian",
    status: ONCHAIN,
    tone: "paper",
    what: "Re-checks every loan on each price update. Alerts you, or repays automatically, before the health factor reaches liquidation.",
    icon: "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6zM9 12l2 2 4-4",
    logos: [{ name: "Morpho", src: "/logos/morpho.png", rel: "Liquidation rules" }],
  },
  {
    n: "04",
    name: "Cloak",
    href: "#cloak",
    status: "Live ZK proofs",
    tone: "live",
    what: "Proves a loan is safely backed at the Oracle price with a zero-knowledge proof, without revealing its size or liquidation level.",
    icon: "M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 0 0 5M4 4l16 16",
    logos: [
      { name: "Zcash", src: "/logos/zcash.svg", rel: "Same proof system" },
      { name: "Monero", src: "/logos/monero.svg", rel: "Privacy reference" },
    ],
  },
  {
    n: "05",
    name: "Ledger",
    href: "#ledger",
    status: "Testnet ready",
    tone: "ready",
    what: "Stamps each pre-open prediction on Algorand so the track record can't be edited after the bell.",
    icon: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4",
    logos: [{ name: "Algorand", src: "/logos/algorand.svg", rel: "Record chain" }],
  },
  {
    n: "06",
    name: "Earn",
    href: "#earn",
    status: "Read-only",
    tone: "ready",
    what: "Idle USDG earns the Sentora protected RWA rate. Live yield today; deposits stay on Sentora.",
    icon: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
    logos: [{ name: "Sentora", src: "/logos/sentora.png", rel: "Vault curator, third party" }],
  },
];


const VERIFIED_MODULE: Record<string, string> = { Oracle: "Oracle", Vault: "Vault", Guardian: "Guardian", Cloak: "Cloak" };

export function HowItWorks() {
  return (
    <>
      <div className="modules">
        {MODULES.map((m) => (
          <a key={m.name} href={m.href} className="module">
            <div className="module-top">
              <span className="module-n">{m.n}</span>
              <span className={`module-status ${m.tone}`}>{m.status}</span>
            </div>
            <svg className="module-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d={m.icon} />
            </svg>
            <h3>{m.name}</h3>
            {VERIFIED_MODULE[m.name] && verifiedCount(VERIFIED_MODULE[m.name]) > 0 && (
              <span className="module-verified" onClick={(e) => { e.preventDefault(); document.getElementById("verified")?.scrollIntoView({ behavior: "smooth" }); }}>
                Mathematically verified · {verifiedCount(VERIFIED_MODULE[m.name])} properties
              </span>
            )}
            <p>{m.what}</p>
            {m.logos.length > 0 && <ul className="module-logos" aria-label={`${m.name} relationships`}>
              {m.logos.map((l) => (
                <li key={l.name} title={`${l.name} · ${l.rel}`}>
                  <img src={l.src} alt={`${l.name} (${l.rel.toLowerCase()})`} width={22} height={22} />
                </li>
              ))}
            </ul>}
            <span className="module-go">
              Open {m.name} <b>→</b>
            </span>
          </a>
        ))}
      </div>
      <p className="modules-note">
        Logos show a technical relationship only (built on, planned, or shared technology) and do not imply endorsement or
        partnership.
      </p>
    </>
  );
}
