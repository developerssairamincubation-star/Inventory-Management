// Mirrors db/migrations/V6__lending_tables.sql (lending_order). Field names
// are snake_case to match DB columns 1:1 — see departments.ts for why.
// The "exactly one borrower type matches borrower_type" CHECK constraint
// lives in the Flyway migration, not re-declared here.
import { pgTable, uuid, varchar, date, timestamp } from "drizzle-orm/pg-core";
import { borrowerTypeEnum, lendingOrderStatusEnum } from "./enums";
import { students } from "./students";
import { staffs } from "./staffs";
import { users } from "./users";

export const lending_order = pgTable("lending_order", {
  lending_order_id: uuid("lending_order_id").primaryKey().defaultRandom(),
  borrower_type: borrowerTypeEnum("borrower_type").notNull(),
  borrower_student_id: uuid("borrower_student_id").references(() => students.student_id, { onDelete: "restrict" }),
  borrower_staff_id: uuid("borrower_staff_id").references(() => staffs.staff_id, { onDelete: "restrict" }),
  issued_by_user_id: uuid("issued_by_user_id").references(() => users.user_id, { onDelete: "set null" }),
  project_name: varchar("project_name", { length: 255 }),
  mentor_staff_id: uuid("mentor_staff_id").references(() => staffs.staff_id),
  due_date: date("due_date"),
  return_date: date("return_date"),
  status: lendingOrderStatusEnum("status").notNull().default("PENDING"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
