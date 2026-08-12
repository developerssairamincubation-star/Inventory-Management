// Mirrors db/migrations/V4__catalog_tables.sql (products). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
// Non-negative CHECK constraints on unit_cost/low_stock_threshold live in
// the Flyway migration, not re-declared here.
import { pgTable, uuid, varchar, numeric, boolean, integer, text, timestamp } from "drizzle-orm/pg-core";
import { category } from "./category";
import { users } from "./users";

export const products = pgTable("products", {
  product_id: uuid("product_id").primaryKey().defaultRandom(),
  product_name: varchar("product_name", { length: 250 }).notNull(),
  category_id: uuid("category_id").references(() => category.category_id, { onDelete: "set null" }),
  unit_cost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  returnable: boolean("returnable").notNull().default(true),
  consumable: boolean("consumable").notNull().default(false),
  low_stock_threshold: integer("low_stock_threshold").notNull().default(0),
  serial_number: varchar("serial_number", { length: 100 }),
  product_code: text("product_code").unique(),
  user_id: uuid("user_id").references(() => users.user_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
