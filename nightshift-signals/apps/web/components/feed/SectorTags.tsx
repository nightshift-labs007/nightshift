import { useCategory } from "@/components/ui/CategoryLabel";

export function SectorTags({ cat, regions }: { cat: string | null; regions: string[] }) {
  const category = useCategory();
  return (
    <span className="flex flex-wrap gap-1">
      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">{category(cat)}</span>
      {regions.slice(0, 3).map((r) => (
        <span key={r} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">{r}</span>
      ))}
    </span>
  );
}
