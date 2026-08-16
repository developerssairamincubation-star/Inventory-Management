// Mirrors db/migrations/V6__lending_tables.sql + V20__lending_students_only.sql
// (lending_order). Field names are snake_case to match DB columns 1:1 — see
// departments.ts for why. Students-only as of V20: chk_lending_borrower_student_only
// enforces borrower_type='STUDENT' and borrower_student_id set, which is why
// borrower_type is still a column (the enum keeps an unused 'STAFF' value —
// Postgres can't cheaply drop one — but the CHECK is what actually enforces it).
import { pgTable, uuid, date, timestamp } from "drizzle-orm/pg-core";
import { borrowerTypeEnum, lendingOrderStatusEnum } from "./enums";
import { students } from "./students";
import { users } from "./users";
import { coe_domains } from "./coeDomains";

export const lending_order = pgTable("lending_order", {
  lending_order_id: uuid("lending_order_id").primaryKey().defaultRandom(),
  borrower_type: borrowerTypeEnum("borrower_type").notNull(),
  borrower_student_id: uuid("borrower_student_id").references(() => students.student_id, { onDelete: "restrict" }),
  issued_by_user_id: uuid("issued_by_user_id").references(() => users.user_id, { onDelete: "set null" }),
  // Which COE domain this lending entry belongs to (db/migrations/V13) —
  // auto-filled from the issuing user's own domain, or manually chosen when
  // the issuer (e.g. super_admin) has none. RESTRICT: a domain with lending
  // history can't be deleted.
  domain_id: uuid("domain_id").references(() => coe_domains.domain_id, { onDelete: "restrict" }),
  due_date: date("due_date"),
  return_date: date("return_date"),
  status: lendingOrderStatusEnum("status").notNull().default("PENDING"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
