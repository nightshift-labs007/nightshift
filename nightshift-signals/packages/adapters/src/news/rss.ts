import { XMLParser } from "fast-xml-parser";
import { cleanText, SUMMARY_MAX, type NewsSource, type RawHeadline } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

type Node = Record<string, unknown> | string | undefined;
const text = (n: Node): string | undefined =>
  n === undefined ? undefined : typeof n === "string" ? n : (n["#text"] as string | undefined) ?? undefined;
const toDate = (s: string | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Parses RSS 2.0 and Atom. Keeps title, a short summary and the link, never article bodies. */
export function parseFeed(xml: string, lang = "en"): RawHeadline[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const out: RawHeadline[] = [];

  for (const item of doc.rss?.channel?.item ?? []) {
    const link = text(item.link?.[0]);
    const title = cleanText(text(item.title));
    if (!link || !title) continue;
    out.push({
      source_item_id: text(item.guid) ?? link,
      url: link.trim(),
      title,
      summary: cleanText(text(item.description), SUMMARY_MAX),
      lang,
      published_at: toDate(text(item.pubDate) ?? text(item["dc:date"])),
    });
  }

  for (const entry of doc.feed?.entry ?? []) {
    const links = (entry.link ?? []) as Record<string, string>[];
    const link = (links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0])?.["@href"];
    const title = cleanText(text(entry.title));
    if (!link || !title) continue;
    out.push({
      source_item_id: text(entry.id) ?? link,
      url: link.trim(),
      title,
      summary: cleanText(text(entry.summary) ?? text(entry.content), SUMMARY_MAX),
      lang,
      published_at: toDate(text(entry.published) ?? text(entry.updated)),
    });
  }
  return out;
}

export class RssSource implements NewsSource {
  readonly kind = "rss";
  constructor(private timeoutMs = 4000) {}

  async fetch(url: string): Promise<RawHeadline[]> {
    const res = await fetch(url, {
      headers: { "user-agent": "NightshiftSignalsBot/0.1 (+https://nightshift-signals.example)", accept: "application/rss+xml, application/atom+xml, */*" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`rss ${url}: HTTP ${res.status}`);
    return parseFeed(await res.text());
  }
}
