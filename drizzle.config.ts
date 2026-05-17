import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Session-mode direct connection (port 5432) for migrations.
    // Runtime queries use DATABASE_URL (pooled, port 6543) via Drizzle's postgres-js client.
    url: process.env.DATABASE_URL_DIRECT ?? "",
  },
  strict: true,
  verbose: true,
});
