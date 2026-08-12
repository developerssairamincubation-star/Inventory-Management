// Mirrors db/migrations/V2__iam_tables.sql (users). The `role IN
// ('super_admin','user')` CHECK constraint lives in the Flyway migration,
// not re-declared here — this file is a query-layer view of the schema, not
// the schema's source of truth.
import { pgTable, uuid, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { departments } from "./departments";

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  departmentId: uuid("department_id").references(() => departments.departmentId, { onDelete: "set null" }),
  role: text("role").notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = "super_admin" | "user";
