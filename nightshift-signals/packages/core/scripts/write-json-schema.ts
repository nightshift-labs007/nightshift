// Writes packages/core/json-schema/<Name>.json from the Zod schemas.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toJsonSchemas } from "../src/json-schema";

const outDir = fileURLToPath(new URL("../json-schema/", import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(toJsonSchemas())) {
  writeFileSync(`${outDir}${name}.json`, JSON.stringify(schema, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(toJsonSchemas()).length} schemas to ${outDir}`);
