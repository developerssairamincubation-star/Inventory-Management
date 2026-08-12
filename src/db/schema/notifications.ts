// Mirrors db/migrations/V8__notifications_table.sql. Reserved for future
// use, not yet wired to any route.
import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  notificationId: uuid("notification_id").primaryKey().defaultRandom(),
  notificationType: varchar("notification_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
