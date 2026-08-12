// Test-only Drizzle client pointed at DATABASE_TEST_URL (the separate
// inventory_test database — see db/init/01_create_test_db.sh). Never import
// this from application code, only from *.test.ts files.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";

const connectionString = process.env.DATABASE_TEST_URL;
if (!connectionString) {
  throw new Error("DATABASE_TEST_URL is not set — tests must run against the inventory_test database");
}

const pool = new Pool({ connectionString, max: 5 });

export const testDb = drizzle(pool, { schema: { ...schema, ...relations } });
export { pool as testPool };
