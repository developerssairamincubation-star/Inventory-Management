import type { DbOrTx } from "@/db/client";
import { category } from "@/db/schema";

// Auto-suggests a unique 2-4 letter category code, avoiding collisions with
// every other category's code. Shared by category creation
// (src/app/api/categories/route.ts) and by product SKU generation
// (src/app/api/products/route.ts, which backfills a missing category's code
// the first time a product needs one) — without a shared source of truth,
// two categories that both lack a code could silently generate the same SKU
// prefix and collide (this happened: a legacy category with no code fell
// back to the same literal "GEN" the uncategorized-product sequence also
// uses, and the two counters produced the same SKU for different products).
// "GEN" is reserved for uncategorized products and never suggested here.
export async function suggestCategoryCode(db: DbOrTx, name: string): Promise<string> {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  const candidates = [letters.slice(0, 2), letters.slice(0, 3), letters.slice(0, 4)].filter((c) => c.length >= 2);

  const existing = await db.select({ code: category.code }).from(category);
  const used = new Set([...existing.map((r) => r.code).filter(Boolean), "GEN"]);

  for (const candidate of candidates) {
    if (!used.has(candidate)) return candidate;
  }
  // Fall back to a numbered variant of the longest candidate if all of its
  // prefixes collide (e.g. two categories both starting "RES...").
  const base = candidates[candidates.length - 1] || "CAT";
  for (let n = 1; n < 100; n++) {
    const candidate = `${base.slice(0, 3)}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `CAT${Date.now() % 1000}`;
}
