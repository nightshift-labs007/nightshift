"use client";

import { useEffect, useState } from "react";

/**
 * A newcomer's first three steps, remembered in this browser only: see a live price, try a practice loan (no wallet),
 * start a Stack. Pages call markStep() when the step happens; the Getting started card ticks them off.
 */
export type Step = "price" | "paper" | "stack";
const KEY = "ns-start";
const HIDE = "ns-start-hidden";
const EVENT = "ns:start-step";

const read = (): Step[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Step[];
  } catch {
    return [];
  }
};

export function markStep(step: Step) {
  const done = read();
  if (done.includes(step)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...done, step]));
  } catch {
    /* storage blocked: the card just won't remember */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function hideSteps() {
  try {
    localStorage.setItem(HIDE, "1");
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The steps done so far, and whether the visitor closed the card. null until read (avoids a flash on load). */
export function useSteps(): { done: Step[]; hidden: boolean } | null {
  const [s, setS] = useState<{ done: Step[]; hidden: boolean } | null>(null);
  useEffect(() => {
    const sync = () => {
      let hidden = false;
      try {
        hidden = localStorage.getItem(HIDE) === "1";
      } catch {
        /* storage blocked */
      }
      setS({ done: read(), hidden });
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return s;
}
