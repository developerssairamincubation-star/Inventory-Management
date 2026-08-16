// Mirrors db/migrations/V12__coe_domains.sql (coe_domains). A domain IS a
// COE, 1:1 with a room. Field names are snake_case to match DB columns
// 1:1 — see departments.ts for why.
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const coe_domains = pgTable("coe_domains", {
  domain_id: uuid("domain_id").primaryKey().defaultRandom(),
  domain_name: varchar("domain_name", { length: 150 }).notNull().unique(),
  room_name: varchar("room_name", { length: 150 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
