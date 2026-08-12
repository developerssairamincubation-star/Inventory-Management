// Mirrors db/migrations/V7__billing_tables.sql (purchase_invoice).
import { pgTable, uuid, varchar, date, numeric, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const purchaseInvoice = pgTable("purchase_invoice", {
  invoiceId: uuid("invoice_id").primaryKey().defaultRandom(),
  supplierName: varchar("supplier_name", { length: 250 }).notNull(),
  orderDate: date("order_date"),
  receivedDate: date("received_date"),
  invoiceNumber: varchar("invoice_number", { length: 100 }),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  userId: uuid("user_id").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
