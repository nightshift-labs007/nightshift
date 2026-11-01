import { openDb } from "./client";

const handle = await openDb();
try {
  await handle.migrate();
  console.log("[db] migrations applied");
} finally {
  await handle.close();
}
