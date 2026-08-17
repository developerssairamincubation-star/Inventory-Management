// Mirrors db/migrations/V7__billing_tables.sql (invoice_documents). Stores
// the uploaded invoice PDF's Cloudinary URL — written by POST /api/invoices,
// read by GET /api/invoices/[id], cleaned up by DELETE /api/invoices/[id].
// Field names are snake_case to match DB columns 1:1 — see departments.ts
// for why.
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { purchase_invoice } from "./purchaseInvoice";
import { users } from "./users";

export const invoice_documents = pgTable("invoice_documents", {
  doc_id: uuid("doc_id").primaryKey().defaultRandom(),
  invoice_id: uuid("invoice_id").notNull().references(() => purchase_invoice.invoice_id, { onDelete: "cascade" }),
  file_url: text("file_url").notNull(),
  uploaded_by_user_id: uuid("uploaded_by_user_id").references(() => users.user_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
