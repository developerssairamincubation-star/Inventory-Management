// Mirrors db/migrations/V8__notifications_table.sql. Reserved for future
// use, not yet wired to any route. Field names are snake_case to match DB
// columns 1:1 — see departments.ts for why.
import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  notification_id: uuid("notification_id").primaryKey().defaultRandom(),
  notification_type: varchar("notification_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
