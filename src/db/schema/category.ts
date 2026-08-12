// Mirrors db/migrations/V4__catalog_tables.sql (category). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const category = pgTable("category", {
  category_id: uuid("category_id").primaryKey().defaultRandom(),
  category_name: text("category_name").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
