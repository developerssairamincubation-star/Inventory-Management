// Mirrors db/migrations/V10__reporting_views.sql. `.existing()` tells
// Drizzle these views are created externally (by Flyway) and should never
// be created/dropped by anything in this codebase.
import { pgView, uuid, varchar, integer, bigint } from "drizzle-orm/pg-core";
import { lendingItemStatusEnum } from "./enums";

export const vwLowStock = pgView("vw_low_stock", {
  productId: uuid("product_id"),
  productName: varchar("product_name", { length: 250 }),
  quantity: integer("quantity"),
  lowStockThreshold: integer("low_stock_threshold"),
  deficit: integer("deficit"),
}).existing();

export const vwTopLendingProducts = pgView("vw_top_lending_products", {
  productId: uuid("product_id"),
  productName: varchar("product_name", { length: 250 }),
  totalIssued: bigint("total_issued", { mode: "number" }),
}).existing();

export const vwLendingStatusDistribution = pgView("vw_lending_status_distribution", {
  status: lendingItemStatusEnum("status"),
  count: bigint("count", { mode: "number" }),
}).existing();
