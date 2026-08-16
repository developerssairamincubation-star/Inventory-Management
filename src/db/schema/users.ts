// Mirrors db/migrations/V2__iam_tables.sql (users). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
// The `role IN ('super_admin','user')` CHECK constraint lives in the Flyway
// migration, not re-declared here.
import { pgTable, uuid, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { departments } from "./departments";
import { coe_domains } from "./coeDomains";

export const users = pgTable("users", {
  user_id: uuid("user_id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password_hash: text("password_hash").notNull(),
  full_name: varchar("full_name", { length: 200 }).notNull(),
  department_id: uuid("department_id").references(() => departments.department_id, { onDelete: "set null" }),
  role: text("role").notNull().default("user"),
  is_active: boolean("is_active").notNull().default(true),
  // Which COE domain this user belongs to (db/migrations/V13). NULL for
  // super_admin (not tied to one domain) and for any 'user' not yet
  // assigned. Auto-fills lending_order.domain_id when this user lends.
  domain_id: uuid("domain_id").references(() => coe_domains.domain_id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = "super_admin" | "user";
