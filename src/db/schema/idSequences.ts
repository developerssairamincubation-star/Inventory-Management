// Mirrors db/migrations/V9__id_sequences_table.sql. Backs atomic
// product_code (STICxxx) / invoice_number (INVxxx) generation — see
// src/lib/idSequences.ts for the allocation helper. Field names are
// snake_case to match DB columns 1:1 — see departments.ts for why.
import { pgTable, text, bigint, integer } from "drizzle-orm/pg-core";

export const id_sequences = pgTable("id_sequences", {
  sequence_key: text("sequence_key").primaryKey(),
  current_value: bigint("current_value", { mode: "number" }).notNull().default(0),
  prefix: text("prefix").notNull(),
  pad_width: integer("pad_width").notNull().default(3),
});
