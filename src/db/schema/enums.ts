// Typed mirror of db/migrations/V1__init_extensions_and_enums.sql.
// Flyway owns the schema; this file is hand-written to match it, never
// generated via drizzle-kit. Keep the value lists in sync by hand.
import { pgEnum } from "drizzle-orm/pg-core";

export const borrowerTypeEnum = pgEnum("borrower_type_enum", ["STUDENT", "STAFF"]);

export const lendingItemStatusEnum = pgEnum("lending_item_status", [
  "ISSUED",
  "RETURNED",
  "OVERDUE",
  "LOST",
  "NON_RETURNABLE_GIVEN",
]);

export const lendingOrderStatusEnum = pgEnum("lending_order_status", [
  "PENDING",
  "RETURNED",
  "CONSUMABLE",
  "PARTIALLY_RETURNED",
  "PARTIALLY_DAMAGED",
  "PARTIALLY_LOST",
  "RETURNED_DAMAGED",
  "RETURNED_LOST",
  "DAMAGED",
  "LOST",
]);

// Mirrors db/migrations/V15__lending_item_type.sql. Per-item
// returnable/consumable marking, chosen freely at lending creation time
// (no per-product flag to validate against as of V24).
export const lendingItemTypeEnum = pgEnum("lending_item_type_enum", ["RETURNABLE", "CONSUMABLE"]);
