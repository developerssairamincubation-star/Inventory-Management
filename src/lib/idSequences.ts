// Atomic allocation from the id_sequences table (db/migrations/V9), fixing
// the old "read last row, increment in JS" race condition for product_code
// (STICxxx) and invoice_number (INVxxx). A single UPDATE...RETURNING locks
// the row for the statement's duration, serializing concurrent callers —
// no separate SELECT ... FOR UPDATE needed.
import { sql, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { id_sequences } from "@/db/schema";

export type SequenceKey = "product_code" | "invoice_number";

export async function allocateNextCode(db: DbOrTx, key: SequenceKey): Promise<string> {
  const [row] = await db
    .update(id_sequences)
    .set({ current_value: sql`${id_sequences.current_value} + 1` })
    .where(eq(id_sequences.sequence_key, key))
    .returning({
      code: sql<string>`${id_sequences.prefix} || lpad(${id_sequences.current_value}::text, ${id_sequences.pad_width}, '0')`,
    });

  if (!row) {
    throw new Error(`id_sequences row missing for key "${key}" — check db/migrations/V9__id_sequences_table.sql`);
  }

  return row.code;
}
