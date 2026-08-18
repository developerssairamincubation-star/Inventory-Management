// Atomic allocation from the id_sequences table (db/migrations/V9), fixing
// the old "read last row, increment in JS" race condition for product_code
// (STICxxx) generation. A single UPDATE...RETURNING locks the row for the
// statement's duration, serializing concurrent callers — no separate
// SELECT ... FOR UPDATE needed.
//
// invoice_number (the free-text, possibly-supplier-printed field) still
// works the way described above: GET /api/invoices/next-number only ever
// *previews* a suggestion, and the client can submit whatever it wants on
// create, with no DB uniqueness constraint. invoice_code (added later,
// V27) is a separate, always-server-generated field that *is* allocated
// through this same atomic mechanism — see POST /api/invoices.
import { sql, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { id_sequences, products } from "@/db/schema";

export type SequenceKey = "product_code" | "invoice_code";

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

// Category-scoped SKU allocation for the coe-inventory auto-SKU/barcode
// feature. Reuses id_sequences (the same atomic counter table backing
// product_code) with a dynamic key per category, seeded lazily on first use
// — unlike allocateNextCode's fixed, pre-seeded "product_code" key, a
// category's row may not exist yet (categories created before this feature
// shipped, or a race with categories/route.ts's own seeding insert), so
// this upserts-then-increments in one atomic statement instead of throwing.
//
// `prefix` is written on every call, not just the first insert: a
// category's code can be corrected later (admin edit, or the self-heal in
// POST /api/products for a category that predates the code feature), and
// without re-syncing it here, an already-seeded sequence row would keep
// generating SKUs under its old, possibly-colliding prefix forever.
//
// The counter's arithmetic alone doesn't guarantee the resulting string is
// actually free: sku_code has a global unique index, and legacy/manually-set
// rows (or two sequences that briefly shared a prefix before that was fixed)
// can already occupy a value this counter is about to produce for the first
// time. Rather than trust the count, each candidate is checked against the
// real products table and skipped if taken — the increment already
// committed for that attempt, so the next call always moves forward instead
// of retrying the same colliding value.
export async function allocateNextSkuCode(db: DbOrTx, categoryId: string | null, prefix: string): Promise<string> {
  const sequenceKey = categoryId ? `sku:${categoryId}` : "sku:uncategorized";
  const padWidth = 4;

  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await db
      .insert(id_sequences)
      .values({ sequence_key: sequenceKey, current_value: 1, prefix, pad_width: padWidth })
      .onConflictDoUpdate({
        target: id_sequences.sequence_key,
        set: { current_value: sql`${id_sequences.current_value} + 1`, prefix },
      })
      .returning({
        code: sql<string>`${id_sequences.prefix} || '-' || lpad(${id_sequences.current_value}::text, ${id_sequences.pad_width}, '0')`,
      });

    const [taken] = await db.select({ id: products.product_id }).from(products).where(eq(products.sku_code, row.code));
    if (!taken) return row.code;
  }

  throw new Error(`Could not allocate a unique SKU for sequence "${sequenceKey}" after 50 attempts — check products.sku_code for unexpected duplication.`);
}
