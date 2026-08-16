// Mirrors db/migrations/V5__inventory_tables.sql (stocks). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
// Non-negative CHECK constraints live in the Flyway migration, not
// re-declared here.
import { pgTable, uuid, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";

export const stocks = pgTable("stocks", {
  stock_id: uuid("stock_id").primaryKey().defaultRandom(),
  product_id: uuid("product_id").notNull().unique().references(() => products.product_id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(0),
  damaged_quantity: integer("damaged_quantity").notNull().default(0),
  lost_quantity: integer("lost_quantity").notNull().default(0),
  // Free-text storage location (e.g. "R2", "L3"), db/migrations/V25. Set per
  // invoice line item when restocking via Upload Invoice.
  location: varchar("location", { length: 50 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
