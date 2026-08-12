// Mirrors db/migrations/V2__iam_tables.sql (password_reset_tokens).
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const passwordResetTokens = pgTable("password_reset_tokens", {
  tokenId: uuid("token_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
