export function SeverityChip({ severity, corroborated }: { severity: number | null; corroborated?: boolean }) {
  if (severity === null) return null;
  const hot = severity >= 4;
  return (
    <span
      title={corroborated ? "Corroborated by 3+ independent sources" : undefined}
      className={`num inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] ${hot ? "bg-hot text-ink" : severity >= 3 ? "bg-hot/20 text-hot" : "bg-panel-2 text-muted"}`}
    >
      SEV {severity}
      {corroborated && <span aria-label="corroborated">✓✓</span>}
    </span>
  );
}
