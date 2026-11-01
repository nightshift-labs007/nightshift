export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Deterministic feature-hashing embedder: word unigrams and bigrams hashed into `dim` buckets.
 * Good enough to catch near-duplicate headlines with no vendor; used in tests and local dev.
 */
export class HashingEmbedder implements Embedder {
  readonly model = "hashing-v1";
  constructor(readonly dim: number) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const grams = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
    for (const g of grams) {
      const h = fnv1a(g);
      v[h % this.dim]! += (h >>> 31) & 1 ? -1 : 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Voyage AI embeddings. Confirm model name and output_dimension support against current Voyage docs. */
export class VoyageEmbedder implements Embedder {
  constructor(
    private apiKey: string,
    readonly dim: number,
    readonly model = "voyage-3.5",
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ input: texts, model: this.model, input_type: "document", output_dimension: this.dim }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`voyage: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return dot / (Math.sqrt(na * nb) || 1);
}
