import { config } from "dotenv";

config({ path: ".env" });

// Tests always run against the isolated inventory_test database (see
// db/init/01_create_test_db.sh), never the dev database — this lets route
// test files import `db` from "@/db/client" directly, same as app code.
if (process.env.DATABASE_TEST_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
}

/**
 * Well-known fixture users.
 *
 * Route tests stub `requireUser` and hand it a user object, which previously
 * meant the user_id in that object never had to correspond to a real row.
 * That stopped being true once stock mutations started writing an audit entry
 * whose actor_user_id is a foreign key into `users` — a synthetic id now
 * fails the insert.
 *
 * Rather than thread a real user through twenty test files, the two ids those
 * tests already use are seeded here, idempotently, before any test runs. The
 * FK on the ledger is worth keeping: an audit trail that can name an actor
 * who doesn't exist isn't much of an audit trail.
 */
export const FIXTURE_USER_ID = "00000000-0000-0000-0000-000000000000";
export const FIXTURE_ADMIN_ID = "11111111-1111-1111-1111-111111111111";

const { db } = await import("@/db/client");
const { users } = await import("@/db/schema");

await db
  .insert(users)
  .values([
    {
      user_id: FIXTURE_USER_ID,
      email: "fixture-user@example.test",
      full_name: "Fixture User",
      role: "user",
      is_active: true,
      password_hash: "not-a-real-hash",
    },
    {
      user_id: FIXTURE_ADMIN_ID,
      email: "fixture-admin@example.test",
      full_name: "Fixture Admin",
      role: "super_admin",
      is_active: true,
      password_hash: "not-a-real-hash",
    },
  ])
  .onConflictDoNothing();
