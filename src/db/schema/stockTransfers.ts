// Mirrors db/migrations/V28__stock_transfers.sql (stock_transfers). Field
// names are snake_case to match DB columns 1:1 — see departments.ts for why.
// CHECK constraints (quantity > 0, mode IN ('full','partial')) live in the
// Flyway migration, not re-declared here.
import { pgTable, uuid, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";
import { coe_domains } from "./coeDomains";
import { users } from "./users";

export const stock_transfers = pgTable("stock_transfers", {
  transfer_id: uuid("transfer_id").primaryKey().defaultRandom(),
  // Same row as destination_product_id for a full transfer (ownership just
  // moves); a different, newly-created row for a partial transfer.
  source_product_id: uuid("source_product_id").references(() => products.product_id, { onDelete: "set null" }),
  destination_product_id: uuid("destination_product_id").references(() => products.product_id, { onDelete: "set null" }),
  source_domain_id: uuid("source_domain_id").notNull().references(() => coe_domains.domain_id, { onDelete: "restrict" }),
  destination_domain_id: uuid("destination_domain_id").notNull().references(() => coe_domains.domain_id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  mode: varchar("mode", { length: 10 }).notNull(),
  transferred_by_user_id: uuid("transferred_by_user_id").references(() => users.user_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockTransferMode = "full" | "partial";
