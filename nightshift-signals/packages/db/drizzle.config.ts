import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://nightshift_signals:nightshift_signals@localhost:5432/nightshift_signals" },
  strict: true,
});
