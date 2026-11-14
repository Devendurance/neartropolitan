import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Single pooled client for request handlers, the indexer, and the worker.
 * Vercel should use a pooled Neon connection string (host contains `-pooler`).
 */
export function createDb(url: string) {
  const client = postgres(url, {
    max: 5,
    idle_timeout: 20,
    prepare: false,
  });
  return drizzle(client, { schema });
}

let cached: ReturnType<typeof createDb> | null = null;

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Neon connection string to .env.local.",
    );
  }
  if (!cached) cached = createDb(url);
  return cached;
}

export type Db = ReturnType<typeof createDb>;
