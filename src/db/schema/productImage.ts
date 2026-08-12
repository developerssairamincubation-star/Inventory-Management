// Mirrors db/migrations/V4__catalog_tables.sql (product_image). Field names
// are snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";

export const product_image = pgTable("product_image", {
  image_id: uuid("image_id").primaryKey().defaultRandom(),
  product_id: uuid("product_id").notNull().references(() => products.product_id, { onDelete: "cascade" }),
  image_url: text("image_url").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
