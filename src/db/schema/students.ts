// Mirrors db/migrations/V3__people_tables.sql (students).
import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { departments } from "./departments";

export const students = pgTable("students", {
  studentId: uuid("student_id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  departmentId: uuid("department_id").references(() => departments.departmentId, { onDelete: "set null" }),
  email: varchar("email", { length: 255 }).unique(),
  phoneNumber: varchar("phone_number", { length: 30 }),
  studentNumber: text("student_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
