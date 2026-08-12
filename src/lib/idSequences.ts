// Atomic allocation from the id_sequences table (db/migrations/V9), fixing
// the old "read last row, increment in JS" race condition for product_code
// (STICxxx) and invoice_number (INVxxx). A single UPDATE...RETURNING locks
// the row for the statement's duration, serializing concurrent callers —
// no separate SELECT ... FOR UPDATE needed.
import { sql } from "drizzle-orm";
import type { db as DbType } from "@/db/client";
import { idSequences } from "@/db/schema";
import { eq } from "drizzle-orm";

export type SequenceKey = "product_code" | "invoice_number";

export async function allocateNextCode(db: typeof DbType, key: SequenceKey): Promise<string> {
  const [row] = await db
    .update(idSequences)
    .set({ currentValue: sql`${idSequences.currentValue} + 1` })
    .where(eq(idSequences.sequenceKey, key))
    .returning({
      code: sql<string>`${idSequences.prefix} || lpad(${idSequences.currentValue}::text, ${idSequences.padWidth}, '0')`,
    });

  if (!row) {
    throw new Error(`id_sequences row missing for key "${key}" — check db/migrations/V9__id_sequences_table.sql`);
  }

  return row.code;
}
