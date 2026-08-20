import { requireUser } from '@/lib/authz'
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { category, id_sequences } from "@/db/schema";
import { suggestCategoryCode } from "@/lib/categoryCode";

export const dynamic = "force-dynamic";

// Pure preview — no mutation — mirrors GET /api/invoices/next-number's
// pattern: it reads the current sequence value and computes what the next
// SKU would be. The real value is only assigned atomically inside
// POST /api/products (via allocateNextSkuCode, src/lib/idSequences.ts) when
// the product is actually saved, so this can drift under concurrent
// creates in the same category — same accepted tradeoff as the invoice
// number preview.
export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url);
    const category_id = searchParams.get("category_id") || null;

    let prefix = "GEN";
    if (category_id) {
      const [cat] = await db
        .select({ category_name: category.category_name, code: category.code })
        .from(category)
        .where(eq(category.category_id, category_id));
      if (cat?.code) {
        prefix = cat.code;
      } else if (cat) {
        // Preview-only — doesn't persist. Mirrors what POST /api/products
        // will actually backfill onto this category the first time a
        // product is created in it, so the preview stays accurate.
        prefix = await suggestCategoryCode(db, cat.category_name);
      }
    }

    const sequenceKey = category_id ? `sku:${category_id}` : "sku:uncategorized";
    const [seq] = await db
      .select({ current_value: id_sequences.current_value })
      .from(id_sequences)
      .where(eq(id_sequences.sequence_key, sequenceKey));

    const nextValue = (seq?.current_value ?? 0) + 1;
    const sku = `${prefix}-${String(nextValue).padStart(4, "0")}`;

    return NextResponse.json({ sku });
  } catch (error) {
    console.error('[GET /api/products/next-sku] falling back to null:', error);
    return NextResponse.json({ sku: null });
  }
}
