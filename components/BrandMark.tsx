import { useId } from "react";

/** Nightshift "Night Watch" mark: a crescent moon whose dark side holds a watching eye. */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  const mask = useId();
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <mask id={mask}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="41" cy="25" r="20" fill="#000" />
        </mask>
      </defs>
      <circle cx="32" cy="32" r="25" fill="currentColor" mask={`url(#${mask})`} />
      <circle cx="41" cy="25" r="9.5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="41" cy="25" r="4.2" fill="#ff963e" />
    </svg>
  );
}
