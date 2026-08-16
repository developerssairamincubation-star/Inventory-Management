// Mirrors db/migrations/V10__reporting_views.sql. `.existing()` tells
// Drizzle these views are created externally (by Flyway) and should never
// be created/dropped by anything in this codebase. Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgView, uuid, varchar, bigint } from "drizzle-orm/pg-core";
import { lendingItemStatusEnum } from "./enums";

// vw_low_stock was dropped in db/migrations/V19 alongside
// products.low_stock_threshold — no low-stock feature in this app anymore.

export const vw_top_lending_products = pgView("vw_top_lending_products", {
  product_id: uuid("product_id"),
  product_name: varchar("product_name", { length: 250 }),
  total_issued: bigint("total_issued", { mode: "number" }),
}).existing();

export const vw_lending_status_distribution = pgView("vw_lending_status_distribution", {
  status: lendingItemStatusEnum("status"),
  count: bigint("count", { mode: "number" }),
}).existing();
