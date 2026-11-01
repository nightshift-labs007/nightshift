import type { ReactNode } from "react";

export function Panel({ children, className = "", accent }: { children: ReactNode; className?: string; accent?: "hot" | "cool" }) {
  const bar = accent === "hot" ? "border-l-2 border-l-hot" : accent === "cool" ? "border-l-2 border-l-cool" : "";
  return <section className={`rounded-xl border border-line bg-panel p-4 ${bar} ${className}`}>{children}</section>;
}

export function Eyebrow({ children, tone = "hot" }: { children: ReactNode; tone?: "hot" | "cool" | "muted" }) {
  const c = tone === "hot" ? "text-hot" : tone === "cool" ? "text-cool" : "text-muted";
  return <p className={`eyebrow font-mono text-[11px] uppercase tracking-[0.18em] ${c}`}>{children}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-1 font-display text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-panel ${className}`} />;
}
