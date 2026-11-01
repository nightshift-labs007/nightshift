/** Headline → causal steps → sectors, as a chain of boxes. Wraps to a column on narrow screens. */
export function WhyGraph({ steps, label }: { steps: string[]; label: string }) {
  if (steps.length < 2) return null;
  return (
    <figure aria-label={label}>
      <figcaption className="eyebrow mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</figcaption>
      <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-col items-center gap-1 sm:flex-1 sm:flex-row">
            <span
              className={`w-full rounded-lg border px-3 py-2 text-center text-sm ${i === 0 ? "border-hot/60" : i === steps.length - 1 ? "border-cool/60" : "border-line"} bg-panel-2`}
            >
              {s}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className="text-muted">
                <span className="sm:hidden">↓</span>
                <span className="hidden sm:inline">→</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}
