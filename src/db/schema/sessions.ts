// Mirrors db/migrations/V2__iam_tables.sql (sessions). Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
// Refresh-token store: token_hash is SHA-256 of the raw refresh token (see
// src/lib/sessions.ts) — the raw value only ever lives in the client's
// httpOnly cookie. replaced_by chains rotated tokens together so reuse of an
// already-rotated token can be detected as theft.
import { pgTable, uuid, text, timestamp, inet, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./users";

export const sessions = pgTable("sessions", {
  session_id: uuid("session_id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
  replaced_by: uuid("replaced_by").references((): AnyPgColumn => sessions.session_id),
  user_agent: text("user_agent"),
  ip_address: inet("ip_address"),
  last_activity: timestamp("last_activity", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
