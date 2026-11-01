import { cleanText, type NewsSource, type RawHeadline } from "./types";

/** Replays a list of headlines one at a time, for local demos. */
export class ScriptedNews implements NewsSource {
  readonly kind = "scripted";
  private i = 0;
  constructor(
    private headlines: string[],
    private now: () => Date = () => new Date(),
  ) {}

  async fetch(): Promise<RawHeadline[]> {
    const title = this.headlines[this.i % this.headlines.length]!;
    const n = this.i++;
    return [{ source_item_id: `demo-${n}-${this.now().getTime()}`, url: `https://example.com/demo/${n}`, title: cleanText(title)!, summary: null, lang: "en", published_at: this.now() }];
  }
}

/** Routes each source URL to its own adapter by scheme: `scripted:` for demos, RSS otherwise. */
export class RoutedNews implements NewsSource {
  readonly kind = "routed";
  constructor(private routes: { match: (url: string) => boolean; source: NewsSource }[]) {}
  fetch(url: string) {
    const r = this.routes.find((x) => x.match(url));
    if (!r) throw new Error(`no news adapter for ${url}`);
    return r.source.fetch(url);
  }
}
