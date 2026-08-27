// Integration test against the real inventory_test database (Vitest points
// DATABASE_URL at it — see vitest.setup.ts) — the whole point of this table
// is atomic behavior under Postgres's row locking, which a mocked DB can't
// exercise.
import { describe, it, expect } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { id_sequences, products } from "@/db/schema";
import { allocateNextCode, allocateNextSkuCode } from "./idSequences";

describe("idSequences", () => {
  it("allocates a formatted, incrementing code", async () => {
    const [before] = await db.select().from(id_sequences).where(eq(id_sequences.sequence_key, "product_code"));
    const code = await allocateNextCode(db, "product_code");
    expect(code).toBe(`STIC${String(before.current_value + 1).padStart(3, "0")}`);
  });

  it("never allocates the same code twice under concurrent callers", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => allocateNextCode(db, "product_code")),
    );
    expect(new Set(results).size).toBe(10);
  });

  it("keeps growing past the pad width instead of truncating", async () => {
    // Regression, found by load testing. Postgres's lpad() TRUNCATES an input
    // longer than the target width — lpad('1001', 3, '0') is '100', not
    // '1001'. product_code has pad_width 3, so every allocation from 1000
    // onward rendered as STIC100/STIC101/… , colliding with codes already
    // issued at 100/101/… . products_product_code_key then rejected the
    // insert and POST /api/products returned a 500. Nine of every ten product
    // creations failed, permanently, from the 1000th product onward.
    //
    // The test above could never catch it: JS's padStart() does NOT truncate,
    // so the expectation was correct all along — the test database's counter
    // simply never got past 999, which is where the two implementations
    // start to disagree. Hence this test, which puts it there on purpose.
    const [original] = await db
      .select()
      .from(id_sequences)
      .where(eq(id_sequences.sequence_key, "product_code"));

    try {
      await db
        .update(id_sequences)
        .set({ current_value: 999 })
        .where(eq(id_sequences.sequence_key, "product_code"));

      expect(await allocateNextCode(db, "product_code")).toBe("STIC1000");
      expect(await allocateNextCode(db, "product_code")).toBe("STIC1001");

      // And across the next order of magnitude, where a 4-wide pad would fail
      // the same way.
      await db
        .update(id_sequences)
        .set({ current_value: 9999 })
        .where(eq(id_sequences.sequence_key, "product_code"));

      expect(await allocateNextCode(db, "product_code")).toBe("STIC10000");
    } finally {
      await db
        .update(id_sequences)
        .set({ current_value: original.current_value })
        .where(eq(id_sequences.sequence_key, "product_code"));
    }
  });

  it("still zero-pads values below the pad width", async () => {
    const [original] = await db
      .select()
      .from(id_sequences)
      .where(eq(id_sequences.sequence_key, "product_code"));

    try {
      await db
        .update(id_sequences)
        .set({ current_value: 6 })
        .where(eq(id_sequences.sequence_key, "product_code"));

      expect(await allocateNextCode(db, "product_code")).toBe("STIC007");
    } finally {
      await db
        .update(id_sequences)
        .set({ current_value: original.current_value })
        .where(eq(id_sequences.sequence_key, "product_code"));
    }
  });
});

describe("allocateNextSkuCode", () => {
  const categoryId = "qa-idseq-cat-11111111-1111-1111-1111-111111111111";

  it("self-seeds a fresh category's counter at 1", async () => {
    await db.delete(id_sequences).where(eq(id_sequences.sequence_key, `sku:${categoryId}`));
    const code = await allocateNextSkuCode(db, categoryId, "ARD");
    expect(code).toBe("ARD-0001");
  });

  it("increments an existing category counter", async () => {
    const second = await allocateNextSkuCode(db, categoryId, "ARD");
    expect(second).toBe("ARD-0002");
  });

  it("falls back to the uncategorized sequence when categoryId is null", async () => {
    const code = await allocateNextSkuCode(db, null, "GEN");
    expect(code).toMatch(/^GEN-\d{4}$/);
  });

  it("re-syncs the stored prefix on every call, so a corrected category code takes effect immediately", async () => {
    // Regression: a category created before the code feature (or whose code
    // was later corrected) must not keep generating SKUs under its old
    // prefix forever — that's how two categories both defaulting to "GEN"
    // ended up producing colliding SKUs for different products.
    const staleCategoryId = "qa-idseq-stale-33333333-3333-3333-3333-333333333333";
    await db.delete(id_sequences).where(eq(id_sequences.sequence_key, `sku:${staleCategoryId}`));
    const stale = await allocateNextSkuCode(db, staleCategoryId, "GEN");
    expect(stale).toBe("GEN-0001");
    const corrected = await allocateNextSkuCode(db, staleCategoryId, "STL");
    expect(corrected).toBe("STL-0002");
    await db.delete(id_sequences).where(eq(id_sequences.sequence_key, `sku:${staleCategoryId}`));
  });

  it("never allocates the same code twice under concurrent callers", async () => {
    const raceCategoryId = "qa-idseq-race-22222222-2222-2222-2222-222222222222";
    const results = await Promise.all(
      Array.from({ length: 10 }, () => allocateNextSkuCode(db, raceCategoryId, "RCE")),
    );
    expect(new Set(results).size).toBe(10);
    await db.delete(id_sequences).where(eq(id_sequences.sequence_key, `sku:${raceCategoryId}`));
  });

  it("skips a value already taken by a legacy/pre-existing product row, even on a brand-new sequence", async () => {
    // Regression: a fresh "sku:uncategorized" sequence counting up from 0
    // independently produces "GEN-0001" as its first allocation — if some
    // other product already holds that exact sku_code (e.g. a row created
    // before this counter existed, or before an earlier prefix-collision fix
    // landed), the arithmetic alone can't know to avoid it. The insert would
    // then fail on products' unique sku_code index. Allocation must check
    // the real table and skip forward instead of handing out a doomed value.
    const staleSkuCategoryId = "qa-idseq-stalesku-44444444-4444-4444-4444-444444444444";
    await db.delete(id_sequences).where(eq(id_sequences.sequence_key, `sku:${staleSkuCategoryId}`));
    await db.delete(products).where(eq(products.sku_code, "LEGACY-0001"));

    await db.insert(products).values({ product_name: "Legacy Pre-existing Row", sku_code: "LEGACY-0001" });

    const code = await allocateNextSkuCode(db, staleSkuCategoryId, "LEGACY");
    expect(code).toBe("LEGACY-0002");

    await db.delete(products).where(eq(products.sku_code, "LEGACY-0001"));
    await db.delete(id_sequences).where(eq(id_sequences.sequence_key, `sku:${staleSkuCategoryId}`));
  });

  it("cleans up its test sequence rows", async () => {
    await db.delete(id_sequences).where(like(id_sequences.sequence_key, "sku:qa-idseq-%"));
  });
});
