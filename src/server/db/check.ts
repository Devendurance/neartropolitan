import "dotenv/config";
import { config } from "dotenv";
import { getDb } from "./client";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

async function main() {
  const db = getDb();
  const result = await db.execute(sql`select version() as version`);
  const rows = result as unknown as Array<{ version: string }>;
  console.log("database reachable");
  console.log(rows[0]?.version ?? "unknown version");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
