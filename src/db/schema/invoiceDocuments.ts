// Mirrors db/migrations/V7__billing_tables.sql (invoice_documents). Not yet
// queried by any route (kept for parity with the original schema).
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { purchaseInvoice } from "./purchaseInvoice";
import { users } from "./users";

export const invoiceDocuments = pgTable("invoice_documents", {
  docId: uuid("doc_id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => purchaseInvoice.invoiceId, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
