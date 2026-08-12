// Mirrors db/migrations/V3__people_tables.sql (students). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { departments } from "./departments";

export const students = pgTable("students", {
  student_id: uuid("student_id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  department_id: uuid("department_id").references(() => departments.department_id, { onDelete: "set null" }),
  email: varchar("email", { length: 255 }).unique(),
  phone_number: varchar("phone_number", { length: 30 }),
  student_number: text("student_number"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
