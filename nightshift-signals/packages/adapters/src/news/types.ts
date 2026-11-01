/** A headline as a source adapter sees it, before it gets an id. Title, summary and link only. */
export interface RawHeadline {
  source_item_id: string;
  url: string;
  title: string;
  summary: string | null;
  lang: string;
  published_at: Date | null;
}

export interface NewsSource {
  readonly kind: string;
  fetch(url: string): Promise<RawHeadline[]>;
}

export const SUMMARY_MAX = 280;

export function cleanText(html: string | null | undefined, max = Infinity): string | null {
  if (!html) return null;
  const text = String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
