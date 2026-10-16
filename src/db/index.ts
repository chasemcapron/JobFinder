import path from "node:path";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

type GlobalWithDb = typeof globalThis & { __jobfinderDb?: Promise<Db> };
const g = globalThis as GlobalWithDb;

/**
 * Returns the Drizzle client. With DATABASE_URL set it connects to Postgres
 * (Neon/Supabase). Without it, outside production, it starts an embedded
 * PGlite database under .data/ and applies migrations automatically, so the
 * app runs locally with zero setup.
 */
export function getDb(): Promise<Db> {
  if (!g.__jobfinderDb) {
    g.__jobfinderDb = createDb().catch((err) => {
      g.__jobfinderDb = undefined;
      throw err;
    });
  }
  return g.__jobfinderDb;
}

async function createDb(): Promise<Db> {
  const url = env.databaseUrl;
  if (url) {
    // prepare:false keeps it compatible with transaction-mode poolers (Supabase, Neon pooled URLs).
    const client = postgres(url, { prepare: false, max: 5 });
    return drizzlePostgres(client, { schema });
  }
  if (env.isProduction && process.env.ALLOW_PGLITE_IN_PRODUCTION !== "true") {
    throw new Error("DATABASE_URL is not set. Add a Postgres connection string (Neon or Supabase).");
  }
  return createPglite(process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite"));
}

/** Embedded Postgres; also used by tests with dataDir "memory://". */
export async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  // The query-builder API is identical; only the driver differs.
  return db as unknown as Db;
}

export { schema };
