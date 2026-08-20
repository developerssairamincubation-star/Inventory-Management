// Regression tests for the stock-integrity defects.
//
// Each case here corresponds to something that was exploitable or silently
// wrong before, and that the previous suite could not have caught: it stubbed
// authorization and never exercised concurrency, negative inputs, or the
// arithmetic that turned a subtraction into an addition.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, products, stocks, stock_ledger } from "@/db/schema";
import { adjustStock, setStock, recordWriteOff, actorFrom, lockStock } from "@/lib/stock";
import { isApiError } from "@/lib/api/errors";

const SUFFIX = randomBytes(4).toString("hex");

let ACTOR_ID: string;
let PRODUCT_ID: string;

const actor = () => actorFrom({ user_id: ACTOR_ID, email: `stock-${SUFFIX}@example.test` });

async function resetTo(quantity: number) {
  await db.update(stocks).set({ quantity, damaged_quantity: 0, lost_quantity: 0 }).where(eq(stocks.product_id, PRODUCT_ID));
}

async function currentQuantity() {
  const [row] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  return row.quantity;
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `stock-actor-${SUFFIX}@example.test`,
      password_hash: "irrelevant",
      full_name: "Stock Test Actor",
    })
    .returning();
  ACTOR_ID = user.user_id;

  const [product] = await db
    .insert(products)
    .values({ product_name: `Stock Test Product ${SUFFIX}`, unit_cost: "1", user_id: ACTOR_ID, sku_code: `ST-${SUFFIX}` })
    .returning();
  PRODUCT_ID = product.product_id;
  await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 10 });
});

afterAll(async () => {
  await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(users).where(eq(users.user_id, ACTOR_ID));
});

describe("adjustStock", () => {
  it("refuses to take the balance below zero instead of clamping to it", async () => {
    // `Math.max(0, current - n)` was used as the guard. That is not a guard,
    // it is silent data loss: over-issuing 500 units of a product with 10 in
    // stock wrote 0 and lost the 490-unit discrepancy permanently.
    await resetTo(10);

    await expect(
      db.transaction((tx) =>
        adjustStock(tx, { productId: PRODUCT_ID, delta: -500, reason: "LEND_ISSUED", actor: actor() }),
      ),
    ).rejects.toSatisfy((err: unknown) => isApiError(err) && err.status === 409 && err.code === "INSUFFICIENT_STOCK");

    expect(await currentQuantity()).toBe(10);
  });

  it("names the actual shortfall so the caller can show a real number", async () => {
    await resetTo(3);
    try {
      await db.transaction((tx) =>
        adjustStock(tx, { productId: PRODUCT_ID, delta: -8, reason: "LEND_ISSUED", actor: actor() }),
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isApiError(err) && err.details).toEqual({ available: 3, requested: 8 });
    }
  });

  it("rejects a non-integer adjustment", async () => {
    await resetTo(10);
    await expect(
      db.transaction((tx) =>
        adjustStock(tx, { productId: PRODUCT_ID, delta: 1.5, reason: "MANUAL_ADJUSTMENT", actor: actor() }),
      ),
    ).rejects.toSatisfy((err: unknown) => isApiError(err) && err.status === 400);
  });

  it("serialises concurrent decrements instead of losing one", async () => {
    // The defect this covers: every stock path read a quantity, computed a
    // new absolute in JavaScript, and wrote it back with no lock. Two
    // operators acting at once both read 10 and both wrote 9 — one decrement
    // vanished with no error and no trace.
    await resetTo(10);

    await Promise.all(
      Array.from({ length: 8 }, () =>
        db.transaction((tx) =>
          adjustStock(tx, { productId: PRODUCT_ID, delta: -1, reason: "LEND_ISSUED", actor: actor() }),
        ),
      ),
    );

    expect(await currentQuantity()).toBe(2);
  });

  it("lets exactly as many concurrent claims succeed as there is stock for", async () => {
    await resetTo(5);

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        db.transaction((tx) =>
          adjustStock(tx, { productId: PRODUCT_ID, delta: -1, reason: "LEND_ISSUED", actor: actor() }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
    expect(await currentQuantity()).toBe(0);
  });

  it("writes an audit entry naming the actor and the reason", async () => {
    await resetTo(10);
    await db.transaction((tx) =>
      adjustStock(tx, { productId: PRODUCT_ID, delta: -2, reason: "LEND_ISSUED", actor: actor(), note: "unit test" }),
    );

    // Matched by note rather than by "most recent": created_at ties within a
    // millisecond, so ordering doesn't identify a specific entry reliably.
    const [entry] = await db
      .select()
      .from(stock_ledger)
      .where(and(eq(stock_ledger.product_id, PRODUCT_ID), eq(stock_ledger.note, "unit test")));

    expect(entry).toBeDefined();
    expect(entry.actor_user_id).toBe(ACTOR_ID);
    expect(entry.actor_email).toBe(`stock-${SUFFIX}@example.test`);
    expect(entry.reason).toBe("LEND_ISSUED");
    expect(entry.quantity_delta).toBe(-2);
    expect(entry.quantity_after).toBe(8);
  });

  it("keeps the ledger append-only", async () => {
    await resetTo(10);
    await db.transaction((tx) =>
      adjustStock(tx, { productId: PRODUCT_ID, delta: 1, reason: "MANUAL_ADJUSTMENT", actor: actor() }),
    );
    const entries = await db.select().from(stock_ledger).where(eq(stock_ledger.product_id, PRODUCT_ID));
    const target = entries.at(-1)!;

    // An audit trail the application can quietly rewrite is not an audit
    // trail — the database refuses, not just our code.
    await expect(
      db.update(stock_ledger).set({ note: "tampered" }).where(eq(stock_ledger.entry_id, target.entry_id)),
    ).rejects.toThrow();

    await expect(
      db.delete(stock_ledger).where(eq(stock_ledger.entry_id, target.entry_id)),
    ).rejects.toThrow();
  });
});

describe("recordWriteOff", () => {
  it("does not decrement shelf quantity a second time", async () => {
    // Units marked lost or damaged left the shelf when the loan was issued.
    // The old routes decremented stocks.quantity again here, so every loss
    // was counted out of inventory twice.
    await resetTo(10);

    const result = await db.transaction((tx) =>
      recordWriteOff(tx, { productId: PRODUCT_ID, quantity: 3, kind: "lost", actor: actor() }),
    );

    expect(result.quantity).toBe(10);
    expect(result.lost).toBe(3);
    expect(await currentQuantity()).toBe(10);

    const [row] = await db
      .select({ lost: stocks.lost_quantity, damaged: stocks.damaged_quantity })
      .from(stocks)
      .where(eq(stocks.product_id, PRODUCT_ID));
    expect(row.lost).toBe(3);
    expect(row.damaged).toBe(0);
  });

  it("rejects a non-positive write-off", async () => {
    await resetTo(10);
    await expect(
      db.transaction((tx) => recordWriteOff(tx, { productId: PRODUCT_ID, quantity: 0, kind: "damaged", actor: actor() })),
    ).rejects.toSatisfy((err: unknown) => isApiError(err) && err.status === 400);
  });
});

describe("setStock", () => {
  it("records the derived delta rather than the requested figure", async () => {
    await resetTo(10);
    await db.transaction((tx) => setStock(tx, { productId: PRODUCT_ID, quantity: 4, actor: actor() }));

    const [entry] = await db
      .select()
      .from(stock_ledger)
      .where(and(eq(stock_ledger.product_id, PRODUCT_ID), eq(stock_ledger.note, "Corrected from 10 to 4")));
    expect(entry).toBeDefined();
    expect(entry.quantity_delta).toBe(-6);
    expect(entry.quantity_after).toBe(4);
    expect(entry.reason).toBe("MANUAL_ADJUSTMENT");
  });

  it("rejects a negative target", async () => {
    await expect(
      db.transaction((tx) => setStock(tx, { productId: PRODUCT_ID, quantity: -1, actor: actor() })),
    ).rejects.toSatisfy((err: unknown) => isApiError(err) && err.status === 400);
  });
});

describe("lockStock", () => {
  it("404s for a product with no stock row", async () => {
    await expect(
      db.transaction((tx) => lockStock(tx, "dead0000-0000-4000-8000-000000000000")),
    ).rejects.toSatisfy((err: unknown) => isApiError(err) && err.status === 404);
  });
});
