// Mirrors db/migrations/V6__lending_tables.sql (lending_item).
import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { lendingItemStatusEnum } from "./enums";
import { lendingOrder } from "./lendingOrder";
import { products } from "./products";

export const lendingItem = pgTable("lending_item", {
  lendingItemId: uuid("lending_item_id").primaryKey().defaultRandom(),
  lendOrderId: uuid("lend_order_id").notNull().references(() => lendingOrder.lendingOrderId, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.productId, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  status: lendingItemStatusEnum("status").notNull().default("ISSUED"),
  originalQuantity: integer("original_quantity").notNull().default(0),
  damagedQuantity: integer("damaged_quantity").notNull().default(0),
  lostQuantity: integer("lost_quantity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
