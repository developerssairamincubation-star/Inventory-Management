import { config } from "dotenv";

config({ path: ".env" });

// Tests always run against the isolated inventory_test database (see
// db/init/01_create_test_db.sh), never the dev database — this lets route
// test files import `db` from "@/db/client" directly, same as app code.
if (process.env.DATABASE_TEST_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
}
