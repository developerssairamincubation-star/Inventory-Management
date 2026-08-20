// Mirrors db/migrations/V31__stock_ledger.sql. Append-only audit trail for
// every change to stocks.quantity. Field names are snake_case to match DB
// columns 1:1 — see departments.ts for why.
//
// The append-only guarantee is a database trigger, not a convention: UPDATE
// and DELETE on this table raise. Drizzle will happily generate either
// statement, and Postgres will reject it.
import { pgTable, uuid, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";
import { users } from "./users";

export const STOCK_LEDGER_REASONS = [
  "PRODUCT_CREATED",
  "INVOICE_RESTOCK",
  "INVOICE_DELETED",
  "LEND_ISSUED",
  "LEND_RETURNED",
  "LEND_DELETED",
  "MARKED_DAMAGED",
  "MARKED_LOST",
  "MANUAL_ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
] as const;

export type StockLedgerReason = (typeof STOCK_LEDGER_REASONS)[number];

export const stock_ledger = pgTable("stock_ledger", {
  entry_id: uuid("entry_id").primaryKey().defaultRandom(),
  // SET NULL, not CASCADE — the trail must outlive the product it describes,
  // which is also why product_name is denormalised onto the row.
  product_id: uuid("product_id").references(() => products.product_id, { onDelete: "set null" }),
  product_name: text("product_name").notNull(),
  // CHECK constraint on the allowed values lives in the Flyway migration.
  reason: varchar("reason", { length: 32 }).notNull().$type<StockLedgerReason>(),
  // Signed: negative leaves the shelf, positive returns to it.
  quantity_delta: integer("quantity_delta").notNull(),
  quantity_after: integer("quantity_after").notNull(),
  actor_user_id: uuid("actor_user_id").references(() => users.user_id, { onDelete: "set null" }),
  actor_email: varchar("actor_email", { length: 255 }),
  request_id: uuid("request_id"),
  reference_id: uuid("reference_id"),
  note: text("note"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
