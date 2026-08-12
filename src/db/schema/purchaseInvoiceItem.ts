// Mirrors db/migrations/V7__billing_tables.sql (purchase_invoice_item).
// Field names are snake_case to match DB columns 1:1 — see departments.ts.
// product_id is nullable: a line item may reference a free-text product_name
// when no matching product row exists yet (see invoices/parse-pdf).
import { pgTable, uuid, text, integer, numeric } from "drizzle-orm/pg-core";
import { purchase_invoice } from "./purchaseInvoice";
import { products } from "./products";

export const purchase_invoice_item = pgTable("purchase_invoice_item", {
  invoice_item_id: uuid("invoice_item_id").primaryKey().defaultRandom(),
  invoice_id: uuid("invoice_id").notNull().references(() => purchase_invoice.invoice_id, { onDelete: "cascade" }),
  product_id: uuid("product_id").references(() => products.product_id, { onDelete: "restrict" }),
  product_name: text("product_name"),
  quantity: integer("quantity").notNull(),
  unit_cost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  total_cost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
});
