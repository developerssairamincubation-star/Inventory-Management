// Drizzle is a typed query layer only — schema DDL lives in db/migrations,
// owned by Flyway. Never run drizzle-kit generate/push against this schema.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";
import { logger } from "@/lib/logger";

const globalForDb = globalThis as unknown as { pgPool?: Pool };

// Deliberately does NOT throw if DATABASE_URL is unset at import time —
// `next build` imports every route module (even purely-dynamic ones with no
// static generation) during its "collecting page data" step, and an eager
// throw here crashes the build itself, not just requests. `pg.Pool` doesn't
// eagerly connect, so construction with an undefined connectionString is
// safe; a real error only surfaces later, when a query actually runs
// without a valid target.
//
// Reuse the pool across Next.js dev-mode HMR re-evaluations of this module,
// otherwise every edit would open a new pool and eventually exhaust
// postgres's max_connections.
const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Without these, one pathological query holds a connection from a pool of
    // 10 indefinitely and the app starves. Both are enforced by the server,
    // so they apply even if the client stops waiting.
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15_000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15_000),
  });

// node-postgres emits errors from *idle* clients on the Pool itself. Node
// treats an unhandled 'error' event as fatal, so without this listener a
// Postgres restart, a Neon idle disconnect, or a transient network fault
// took down the entire process instead of failing a single request.
if (!globalForDb.pgPool) {
  pool.on("error", (err) => {
    logger.error("Idle Postgres client error — pool will reconnect", { component: "pg-pool" }, err);
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export { pool };

/** Liveness probe for /api/health — cheap, and proves a connection can be acquired. */
export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

// Shared type for helpers that must work both as `db.transaction(async (tx)
// => ...)` participants and as standalone calls with the top-level `db` —
// e.g. src/lib/idSequences.ts's allocateNextCode, called from inside the
// products POST route's transaction.
export type DbClient = typeof db;
export type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbOrTx = DbClient | Tx;
