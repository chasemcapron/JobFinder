/**
 * Applies migrations in ./drizzle to DATABASE_URL.
 * Usage: npm run db:migrate   (reads .env.local / .env via Node's --env-file-if-exists)
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is not set; the local PGlite database migrates itself on startup. Nothing to do.");
    return;
  }
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
