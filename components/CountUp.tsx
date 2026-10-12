"use client";

import { useEffect, useRef, useState } from "react";

/** Tweens a number to its new value and flashes green/red in the direction it moved. */
export function CountUp({ value, format }: { value: number; format: (x: number) => string }) {
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<"" | "up" | "down">("");
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    setDir(value > from ? "up" : "down");
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      setShown(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const clear = setTimeout(() => setDir(""), 1400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [value]);

  return <span className={`count ${dir ? `flash-${dir}` : ""}`}>{format(shown)}</span>;
}
