// Node-only (reads the YAML file). Import via "@nightshift-signals/core/taxonomy" so browser bundles stay clean.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { CATEGORIES, type Category } from "./enums";

export const TaxonomyEntry = z.object({
  description: z.string(),
  examples: z.array(z.string()),
  candidates: z.array(z.string()),
  proxy: z.string(),
  default_beta: z.number(),
  typical_move_bps: z.number().int().positive(),
  enabled: z.boolean(),
});
export type TaxonomyEntry = z.infer<typeof TaxonomyEntry>;

export const Taxonomy = z.object({
  version: z.number().int(),
  categories: z.record(z.enum(CATEGORIES), TaxonomyEntry),
});
export type Taxonomy = z.infer<typeof Taxonomy> & { categories: Record<Category, TaxonomyEntry> };

export const DEFAULT_TAXONOMY_PATH = new URL("../taxonomy.yaml", import.meta.url);

/** Read on every call so edits apply without a deploy; callers may cache briefly. */
export function loadTaxonomy(path: string | URL = process.env.TAXONOMY_PATH ?? DEFAULT_TAXONOMY_PATH): Taxonomy {
  const t = Taxonomy.parse(parse(readFileSync(path, "utf8")));
  const missing = CATEGORIES.filter((c) => !(c in t.categories));
  if (missing.length) throw new Error(`taxonomy missing categories: ${missing.join(", ")}`);
  return t as Taxonomy;
}
