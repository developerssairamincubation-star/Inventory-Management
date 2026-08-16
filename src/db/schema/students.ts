// Mirrors db/migrations/V3__people_tables.sql (students). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
// student_number (legacy free-text field) was removed in V24 — superseded
// by student_id_code (V14) as the one canonical student identifier.
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { departments } from "./departments";

export const students = pgTable("students", {
  student_id: uuid("student_id").primaryKey().defaultRandom(),
  // Optional as of V23 — the lending scan flow creates a student record
  // from just the decoded ID; a name is typed in later if given.
  name: varchar("name", { length: 200 }),
  department_id: uuid("department_id").references(() => departments.department_id, { onDelete: "set null" }),
  email: varchar("email", { length: 255 }).unique(),
  phone_number: varchar("phone_number", { length: 30 }),
  // Scanned/typed [college][year][dept][serial] code, e.g. "sit21cs025" —
  // see src/lib/studentIdCode.ts.
  student_id_code: varchar("student_id_code", { length: 10 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
