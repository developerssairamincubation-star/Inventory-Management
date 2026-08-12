// Mirrors db/migrations/V2__iam_tables.sql (departments).
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const departments = pgTable("departments", {
  departmentId: uuid("department_id").primaryKey().defaultRandom(),
  departmentName: varchar("department_name", { length: 150 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
