// Mirrors db/migrations/V9__id_sequences_table.sql. Backs atomic
// product_code (STICxxx) / invoice_number (INVxxx) generation — see
// src/lib/idSequences.ts for the allocation helper.
import { pgTable, text, bigint, integer } from "drizzle-orm/pg-core";

export const idSequences = pgTable("id_sequences", {
  sequenceKey: text("sequence_key").primaryKey(),
  currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
  prefix: text("prefix").notNull(),
  padWidth: integer("pad_width").notNull().default(3),
});
