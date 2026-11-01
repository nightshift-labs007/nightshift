// Drizzle schema and client. Zod schemas in @nightshift-signals/core stay the source of truth;
// enums here are built from them.
export * from "./schema";
export { openDb, MIGRATIONS_DIR, type Db, type DbHandle } from "./client";
export { basketToRows, rowsToBasket } from "./mappers";
// Query helpers re-exported so every package shares this package's drizzle-orm instance.
export { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
export { FairValueService, type FairValueGap, type FairValueReader } from "./fairvalue";
