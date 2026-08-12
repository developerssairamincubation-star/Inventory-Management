// Mirrors db/migrations/V6__lending_tables.sql (lending_order). The
// "exactly one borrower type matches borrower_type" CHECK constraint lives
// in the Flyway migration, not re-declared here.
import { pgTable, uuid, varchar, date, timestamp } from "drizzle-orm/pg-core";
import { borrowerTypeEnum, lendingOrderStatusEnum } from "./enums";
import { students } from "./students";
import { staffs } from "./staffs";
import { users } from "./users";

export const lendingOrder = pgTable("lending_order", {
  lendingOrderId: uuid("lending_order_id").primaryKey().defaultRandom(),
  borrowerType: borrowerTypeEnum("borrower_type").notNull(),
  borrowerStudentId: uuid("borrower_student_id").references(() => students.studentId, { onDelete: "restrict" }),
  borrowerStaffId: uuid("borrower_staff_id").references(() => staffs.staffId, { onDelete: "restrict" }),
  issuedByUserId: uuid("issued_by_user_id").references(() => users.userId, { onDelete: "set null" }),
  projectName: varchar("project_name", { length: 255 }),
  mentorStaffId: uuid("mentor_staff_id").references(() => staffs.staffId),
  dueDate: date("due_date"),
  returnDate: date("return_date"),
  status: lendingOrderStatusEnum("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
