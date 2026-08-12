// Mirrors db/migrations/V4__catalog_tables.sql (products). Non-negative
// CHECK constraints on unit_cost/low_stock_threshold live in the Flyway
// migration, not re-declared here.
import { pgTable, uuid, varchar, numeric, boolean, integer, text, timestamp } from "drizzle-orm/pg-core";
import { category } from "./category";
import { users } from "./users";

export const products = pgTable("products", {
  productId: uuid("product_id").primaryKey().defaultRandom(),
  productName: varchar("product_name", { length: 250 }).notNull(),
  categoryId: uuid("category_id").references(() => category.categoryId, { onDelete: "set null" }),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  returnable: boolean("returnable").notNull().default(true),
  consumable: boolean("consumable").notNull().default(false),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
  serialNumber: varchar("serial_number", { length: 100 }),
  productCode: text("product_code").unique(),
  userId: uuid("user_id").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
