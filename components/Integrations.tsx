/* eslint-disable @next/next/no-img-element */
import { INTEGRATIONS } from "@/lib/sitemap";

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
