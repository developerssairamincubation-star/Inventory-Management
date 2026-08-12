// Mirrors db/migrations/V5__inventory_tables.sql (stocks). Non-negative
// CHECK constraints live in the Flyway migration, not re-declared here.
import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";

export const stocks = pgTable("stocks", {
  stockId: uuid("stock_id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().unique().references(() => products.productId, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(0),
  damagedQuantity: integer("damaged_quantity").notNull().default(0),
  lostQuantity: integer("lost_quantity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
