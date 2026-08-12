// Drizzle is a typed query layer only — schema DDL lives in db/migrations,
// owned by Flyway. Never run drizzle-kit generate/push against this schema.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";

const globalForDb = globalThis as unknown as { pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse the pool across Next.js dev-mode HMR re-evaluations of this module,
// otherwise every edit would open a new pool and eventually exhaust
// postgres's max_connections.
const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export { pool };
