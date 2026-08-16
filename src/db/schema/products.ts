// Mirrors db/migrations/V4__catalog_tables.sql (products). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
// Non-negative CHECK constraint on unit_cost lives in the Flyway migration,
// not re-declared here. low_stock_threshold was removed in V19 — no
// replacement low-stock mechanism for the coe-inventory use case.
// returnable/consumable were removed in V24 — whether a given lend is
// returnable or consumable is chosen per line item at lending time
// (lending_item.item_type, db/migrations/V15), not fixed per product.
import { pgTable, uuid, varchar, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { category } from "./category";
import { users } from "./users";

export const products = pgTable("products", {
  product_id: uuid("product_id").primaryKey().defaultRandom(),
  product_name: varchar("product_name", { length: 250 }).notNull(),
  category_id: uuid("category_id").references(() => category.category_id, { onDelete: "set null" }),
  unit_cost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  // Auto-generated, category-scoped SKU (db/migrations/V18 renamed this
  // from serial_number — it's been the UI's "SKU" field all along). Also
  // the barcode payload printed on product labels; lending's scan-to-fetch
  // looks products up by this. NOT NULL + unique as of V21; the DB default
  // (V22) is a harmless placeholder for inserts that don't care about SKUs
  // (test fixtures) — the real creation route always overrides it.
  sku_code: varchar("sku_code", { length: 100 }).notNull().default(sql`('TMP-' || substr(gen_random_uuid()::text, 1, 8))`),
  product_code: text("product_code").unique(),
  // Optional free-text description (db/migrations/V16).
  description: text("description"),
  user_id: uuid("user_id").references(() => users.user_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
