"use client";

import Link from "next/link";
import { hideSteps, useSteps, type Step } from "@/lib/onboarding";

const STEPS: { id: Step; title: string; how: string; href: string; cta: string }[] = [
  { id: "price", title: "See a live price", how: "What gold, silver and the S&P 500 are worth right now.", href: "/oracle", cta: "See prices" },
  { id: "paper", title: "Try a practice loan", how: "Borrow against demo tokens. No wallet, nothing to install.", href: "/app?try=paper", cta: "Try it" },
  { id: "stack", title: "Start a Stack", how: "Buy gold or silver automatically, only at a fair price.", href: "/app#stack", cta: "Start" },
];

/** "3 steps to get started" for newcomers: ticks each step off as it happens, and can be closed. */
export function GettingStarted() {
  const s = useSteps();
  if (!s || s.hidden) return null;
  const left = STEPS.filter((x) => !s.done.includes(x.id)).length;
  return (
    <section className="start-card panel" aria-label="Getting started">
      <div className="start-head">
        <div>
          <p className="unit">{left ? `Getting started · ${STEPS.length - left} of ${STEPS.length} done` : "All done"}</p>
          <h3>{left ? "Three steps to try Nightshift" : "You've tried everything. Nice."}</h3>
        </div>
        <button className="start-x" onClick={hideSteps} aria-label="Hide getting started">
          ×
        </button>
      </div>
      <ol className="start-steps">
        {STEPS.map((x, i) => {
          const done = s.done.includes(x.id);
          return (
            <li key={x.id} className={done ? "done" : ""}>
              <span className="start-tick" aria-hidden="true">{done ? "✓" : i + 1}</span>
              <span className="start-text">
                <b>{x.title}</b>
                <small>{x.how}</small>
              </span>
              {done ? (
                <span className="start-state">Done</span>
              ) : (
                <Link className="btn secondary small" href={x.href}>
                  {x.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
