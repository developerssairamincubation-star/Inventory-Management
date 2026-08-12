// Mirrors db/migrations/V7__billing_tables.sql (purchase_invoice_item).
// product_id is nullable: a line item may reference a free-text product_name
// when no matching product row exists yet (see invoices/parse-pdf).
import { pgTable, uuid, text, integer, numeric } from "drizzle-orm/pg-core";
import { purchaseInvoice } from "./purchaseInvoice";
import { products } from "./products";

export const purchaseInvoiceItem = pgTable("purchase_invoice_item", {
  invoiceItemId: uuid("invoice_item_id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => purchaseInvoice.invoiceId, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.productId, { onDelete: "restrict" }),
  productName: text("product_name"),
  quantity: integer("quantity").notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
});
