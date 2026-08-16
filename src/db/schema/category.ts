// Mirrors db/migrations/V4__catalog_tables.sql (category). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const category = pgTable("category", {
  category_id: uuid("category_id").primaryKey().defaultRandom(),
  category_name: text("category_name").notNull().unique(),
  // 3-4 letter code (db/migrations/V17), the prefix for auto-generated
  // product SKUs in this category — see src/lib/idSequences.ts
  // allocateNextSkuCode. Nullable until backfilled for pre-existing rows.
  code: varchar("code", { length: 4 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
