/* eslint-disable @next/next/no-img-element */

/** Nightshift mark: the folded mint N (transparent PNG, sits on any dark background). */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return <img className={className} src="/brand/nightshift-n-128.png" alt="" width={28} height={28} aria-hidden="true" />;
}
