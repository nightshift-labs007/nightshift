import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Arbitrary constant key for pg_advisory_lock around migrations. */
const MIGRATION_LOCK_ID = 7_340_219_001;

/**
 * `postgres://…` for real Postgres. `pglite:memory` or `pglite:<dir>` for embedded Postgres + pgvector
 * (tests and `pnpm dev:local`; one process only).
 */
export async function openDb(url = process.env.DATABASE_URL): Promise<DbHandle> {
  if (!url) throw new Error("DATABASE_URL is not set");

  if (url.startsWith("pglite:")) {
    const dir = url.slice("pglite:".length);
    if (dir !== "memory") mkdirSync(dir, { recursive: true });
    const client = new PGlite({ ...(dir === "memory" ? {} : { dataDir: dir }), extensions: { vector } });
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Db,
      migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => client.close(),
    };
  }

  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzlePostgres(sql, { schema });
  return {
    db: db as unknown as Db,
    // api and worker both migrate on boot; a session advisory lock (held on one reserved connection)
    // makes the second process wait, then find nothing left to apply.
    migrate: async () => {
      const conn = await sql.reserve();
      try {
        await conn`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
        await migratePostgres(db, { migrationsFolder: MIGRATIONS_DIR });
      } finally {
        await conn`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => {});
        conn.release();
      }
    },
    close: () => sql.end(),
  };
}
