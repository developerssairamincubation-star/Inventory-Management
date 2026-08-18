// Mirrors db/migrations/V7__billing_tables.sql (purchase_invoice). Field
// names are snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, varchar, date, numeric, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const purchase_invoice = pgTable("purchase_invoice", {
  invoice_id: uuid("invoice_id").primaryKey().defaultRandom(),
  // Atomically-allocated, globally-unique internal ID (e.g. "INV-0001") —
  // see src/lib/idSequences.ts and db/migrations/V27__invoice_code.sql.
  // Distinct from invoice_number below, which is free-text and may be the
  // supplier's own printed number, blank, or duplicated across invoices.
  // POST /api/invoices always explicitly generates and sets this; the
  // .default() below (mirrors products.sku_code) only exists so direct
  // inserts that don't care about invoice codes — test fixtures, one-off
  // scripts — keep working.
  invoice_code: varchar("invoice_code", { length: 50 }).notNull().default(sql`('TMP-' || substr(gen_random_uuid()::text, 1, 8))`),
  supplier_name: varchar("supplier_name", { length: 250 }).notNull(),
  order_date: date("order_date"),
  received_date: date("received_date"),
  invoice_number: varchar("invoice_number", { length: 100 }),
  total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  user_id: uuid("user_id").references(() => users.user_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
