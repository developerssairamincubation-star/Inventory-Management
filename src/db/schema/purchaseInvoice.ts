// Mirrors db/migrations/V7__billing_tables.sql (purchase_invoice). Field
// names are snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, varchar, date, numeric, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const purchase_invoice = pgTable("purchase_invoice", {
  invoice_id: uuid("invoice_id").primaryKey().defaultRandom(),
  supplier_name: varchar("supplier_name", { length: 250 }).notNull(),
  order_date: date("order_date"),
  received_date: date("received_date"),
  invoice_number: varchar("invoice_number", { length: 100 }),
  total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  user_id: uuid("user_id").references(() => users.user_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
