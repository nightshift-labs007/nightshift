import type { MarketId } from "@/lib/markets";

// rounded so server and browser render identical numbers (their trig differs in the last digits)
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Drawn flags: emoji flags don't render on Windows (they show as "IN", "US"), so markets use SVG instead. */
export function Flag({ id, size = 20 }: { id: MarketId | null; size?: number }) {
  const h = Math.round((size * 2) / 3);
  const common = { width: size, height: h, className: "flag", "aria-hidden": true as const };
  if (id === "india")
    return (
      <svg viewBox="0 0 30 20" {...common}>
        <rect width="30" height="20" fill="#fff" />
        <rect width="30" height="6.67" fill="#FF9933" />
        <rect y="13.33" width="30" height="6.67" fill="#138808" />
        <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.6" />
        <circle cx="15" cy="10" r="0.6" fill="#000080" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="15" y1="10" x2={r3(15 + 2.6 * Math.cos((i * Math.PI) / 6))} y2={r3(10 + 2.6 * Math.sin((i * Math.PI) / 6))} stroke="#000080" strokeWidth="0.3" />
        ))}
      </svg>
    );
  if (id === "usa")
    return (
      <svg viewBox="0 0 30 20" {...common}>
        <rect width="30" height="20" fill="#fff" />
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} y={i * (20 / 6.5)} width="30" height={20 / 13} fill="#B22234" />
        ))}
        <rect width="12" height={(20 / 13) * 7} fill="#3C3B6E" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width={h + 2} height={h + 2} className="flag globe" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 12h19M12 2.5c2.8 3 2.8 16 0 19M12 2.5c-2.8 3-2.8 16 0 19" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
