// Mirrors db/migrations/V4__catalog_tables.sql (product_image).
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";

export const productImage = pgTable("product_image", {
  imageId: uuid("image_id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.productId, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
