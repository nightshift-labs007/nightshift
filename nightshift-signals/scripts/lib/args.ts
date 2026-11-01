import { parseArgs } from "node:util";

export function cliArgs<T extends Record<string, { type: "string" | "boolean"; default?: string | boolean }>>(options: T) {
  return parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options, strict: true }).values;
}

export function requireDate(date: unknown): string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: --date YYYY-MM-DD");
    process.exit(2);
  }
  return date;
}
