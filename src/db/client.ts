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
    // Raised from 10 after load testing (see k6/README.md). At 10, requests
    // queued for a connection while Postgres itself sat idle — the pool, not
    // the database, was the ceiling. Every route in this app funnels through
    // one pool, and the read-heavy dashboard routes hold a connection for the
    // whole of a multi-statement handler, so 10 concurrent in-flight requests
    // was enough to exhaust it.
    //
    // 25 is sized against Postgres's own max_connections (100, minus 3
    // reserved for superusers): it leaves room for a second app instance, the
    // Flyway migration job, pg_backup, and a human with psql open.
    //
    // Raise this ONLY alongside max_connections, and be careful on serverless:
    // the pool is per process, so N Vercel instances mean N x this many
    // connections. A serverless deployment should point DATABASE_URL at
    // Neon's *pooled* endpoint and set PGPOOL_MAX low (1-5) instead — there,
    // pgBouncer is the pool and this one is just a client to it.
    max: Number(process.env.PGPOOL_MAX || 25),
    idleTimeoutMillis: 30_000,
    // How long a request waits for a free connection before failing. Worth
    // knowing when reading a load test: with the pool saturated, this is the
    // extra latency a request absorbs before it turns into a 500.
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
