import { z } from "zod";

/** ISO-8601 timestamp with offset. Storage is always UTC. */
export const Timestamp = z.iso.datetime({ offset: true });

/**
 * Money, prices and returns travel as decimal strings, never floats.
 * Up to 18 fractional digits to match numeric(38,18) in Postgres.
 */
export const Decimal = z.string().regex(/^-?\d+(\.\d{1,18})?$/, "expected a decimal string");

export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address");
export const Hash32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected a lowercase 0x 32-byte hash");

/** BCP-47-ish language code: `en`, `hi`, `es`, `pt-BR`. */
export const Lang = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
/** ISO 3166-1 alpha-2. */
export const Country = z.string().regex(/^[A-Z]{2}$/);

export const Bps = z.number().int();
