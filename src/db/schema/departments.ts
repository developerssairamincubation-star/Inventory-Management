// Mirrors db/migrations/V2__iam_tables.sql (departments).
//
// Field names are snake_case, matching the DB columns exactly (not the
// idiomatic Drizzle camelCase convention). This is deliberate: routes return
// query results as JSON directly, and the frontend expects the same
// snake_case field names Supabase/PostgREST used to return
// (department_name, not departmentName) — matching column names 1:1 avoids
// a translation layer in all 28 converted routes.
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const departments = pgTable("departments", {
  department_id: uuid("department_id").primaryKey().defaultRandom(),
  department_name: varchar("department_name", { length: 150 }).notNull().unique(),
  // Admin-managed 2-letter code (db/migrations/V13), used by the
  // student-ID decoder (src/lib/studentIdCode.ts) to resolve a department
  // from a scanned ID. Nullable until an admin backfills existing rows.
  code: varchar("code", { length: 2 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
