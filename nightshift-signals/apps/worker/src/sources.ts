import { newId, type SourceKind } from "@nightshift-signals/core";
import { eq, sources, type Db } from "@nightshift-signals/db";

/**
 * Starter feeds: official government and central-bank press releases (free, no licensing issues).
 * Confirm each URL still serves RSS before relying on it; add wires and X lists as you license them.
 */
export const DEFAULT_SOURCES: { kind: SourceKind; name: string; url: string; trust_weight: number }[] = [
  { kind: "gov", name: "Federal Reserve press releases", url: "https://www.federalreserve.gov/feeds/press_all.xml", trust_weight: 1 },
  { kind: "gov", name: "ECB press releases", url: "https://www.ecb.europa.eu/rss/press.html", trust_weight: 1 },
  { kind: "gov", name: "SEC press releases", url: "https://www.sec.gov/news/pressreleases.rss", trust_weight: 1 },
];

export const DEMO_SOURCE = { kind: "wire" as const, name: "Demo wire (scripted)", url: "scripted:demo", trust_weight: 0.5 };

export async function seedSources(db: Db, list: typeof DEFAULT_SOURCES): Promise<void> {
  for (const s of list) {
    const [found] = await db.select({ id: sources.id }).from(sources).where(eq(sources.url, s.url));
    if (!found) await db.insert(sources).values({ id: newId("source"), kind: s.kind, name: s.name, url: s.url, trustWeight: s.trust_weight });
  }
}
