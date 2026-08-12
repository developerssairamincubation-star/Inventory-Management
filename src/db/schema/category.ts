// Mirrors db/migrations/V4__catalog_tables.sql (category).
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const category = pgTable("category", {
  categoryId: uuid("category_id").primaryKey().defaultRandom(),
  categoryName: text("category_name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
