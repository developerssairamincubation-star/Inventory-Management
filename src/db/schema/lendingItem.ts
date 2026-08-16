// Mirrors db/migrations/V6__lending_tables.sql (lending_item). Field names
// are snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { lendingItemStatusEnum, lendingItemTypeEnum } from "./enums";
import { lending_order } from "./lendingOrder";
import { products } from "./products";

export const lending_item = pgTable("lending_item", {
  lending_item_id: uuid("lending_item_id").primaryKey().defaultRandom(),
  lend_order_id: uuid("lend_order_id").notNull().references(() => lending_order.lending_order_id, { onDelete: "cascade" }),
  product_id: uuid("product_id").notNull().references(() => products.product_id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  status: lendingItemStatusEnum("status").notNull().default("ISSUED"),
  // Per-item returnable/consumable marking (db/migrations/V15), validated
  // at creation against the product's own returnable/consumable flags.
  // Consumable items can never be marked damaged/lost.
  item_type: lendingItemTypeEnum("item_type").notNull().default("RETURNABLE"),
  original_quantity: integer("original_quantity").notNull().default(0),
  damaged_quantity: integer("damaged_quantity").notNull().default(0),
  lost_quantity: integer("lost_quantity").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
