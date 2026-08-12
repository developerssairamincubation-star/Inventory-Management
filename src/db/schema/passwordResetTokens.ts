// Mirrors db/migrations/V2__iam_tables.sql (password_reset_tokens).
// Field names are snake_case to match DB columns 1:1 — see departments.ts.
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const password_reset_tokens = pgTable("password_reset_tokens", {
  token_id: uuid("token_id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
