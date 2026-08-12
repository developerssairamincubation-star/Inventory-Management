// Mirrors db/migrations/V2__iam_tables.sql (sessions). Refresh-token store:
// token_hash is SHA-256 of the raw refresh token (see src/lib/sessions.ts) —
// the raw value only ever lives in the client's httpOnly cookie. replacedBy
// chains rotated tokens together so reuse of an already-rotated token can be
// detected as theft.
import { pgTable, uuid, text, timestamp, inet, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./users";

export const sessions = pgTable("sessions", {
  sessionId: uuid("session_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by").references((): AnyPgColumn => sessions.sessionId),
  userAgent: text("user_agent"),
  ipAddress: inet("ip_address"),
  lastActivity: timestamp("last_activity", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
