// Drizzle is a typed query layer only — schema DDL lives in db/migrations,
// owned by Flyway. Never run drizzle-kit generate/push against this schema.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";

const globalForDb = globalThis as unknown as { pgPool?: Pool };

// Deliberately does NOT throw if DATABASE_URL is unset at import time —
// `next build` imports every route module (even purely-dynamic ones with no
// static generation) during its "collecting page data" step, and an eager
// throw here crashes the build itself, not just requests. `pg.Pool` doesn't
// eagerly connect, so construction with an undefined connectionString is
// safe; a real error only surfaces later, when a query actually runs
// without a valid target. Mirrors the old Supabase client's same deliberate
// laziness (see git history of src/lib/supabaseServer.ts).
//
// Reuse the pool across Next.js dev-mode HMR re-evaluations of this module,
// otherwise every edit would open a new pool and eventually exhaust
// postgres's max_connections.
const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export { pool };

// Shared type for helpers that must work both as `db.transaction(async (tx)
// => ...)` participants and as standalone calls with the top-level `db` —
// e.g. src/lib/idSequences.ts's allocateNextCode, called from inside the
// products POST route's transaction.
export type DbClient = typeof db;
export type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbOrTx = DbClient | Tx;
