import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
});
