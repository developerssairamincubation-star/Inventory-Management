// Route-level regression tests for the three stock-inflation vectors.
//
// src/lib/stock.test.ts covers the helper. These go through the actual HTTP
// handlers with the exact payloads that used to work, so the fixes are proven
// where an attacker would have reached them rather than one layer down.

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, coe_domains, products, stocks, departments, students, lending_order, lending_item, purchase_invoice, purchase_invoice_item, stock_ledger } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { POST as createLending } from "./lending/route";
import { PUT as updateLending } from "./lending/[id]/route";
import { POST as createInvoice } from "./invoices/route";

// Returnable items require a due date (POST /api/lending refines on it): an
// item somebody has to bring back without a date can never go overdue, so
// nothing ever prompts anyone to chase it. Every RETURNABLE payload below
// therefore carries one, so each test still fails for the reason it was
// written to check rather than for a missing date.
const DUE_DATE = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);


const mockRequireUser = vi.mocked(requireUser);
const SUFFIX = randomBytes(4).toString("hex");

let DOMAIN_ID: string;
let OTHER_DOMAIN_ID: string;
let OWNER_ID: string;
let OUTSIDER_ID: string;
let PRODUCT_ID: string;
let OUTSIDER_PRODUCT_ID: string;
let DEPT_ID: string;

function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: OWNER_ID,
    email: `integrity-${SUFFIX}@example.test`,
    full_name: "Integrity User",
    role: "user",
    is_active: true,
    domain_id: DOMAIN_ID,
    ...overrides,
  };
}

async function quantityOf(productId: string) {
  const [row] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, productId));
  return row.quantity;
}

beforeAll(async () => {
  const [domain] = await db.insert(coe_domains).values({ domain_name: `Integrity ${SUFFIX}`, room_name: `Integrity Room ${SUFFIX}` }).returning();
  DOMAIN_ID = domain.domain_id;
  const [other] = await db.insert(coe_domains).values({ domain_name: `Integrity Other ${SUFFIX}`, room_name: `Integrity Other Room ${SUFFIX}` }).returning();
  OTHER_DOMAIN_ID = other.domain_id;

  const [owner] = await db.insert(users).values({ email: `integrity-owner-${SUFFIX}@example.test`, password_hash: "x", full_name: "Owner", domain_id: DOMAIN_ID }).returning();
  OWNER_ID = owner.user_id;
  const [outsider] = await db.insert(users).values({ email: `integrity-outsider-${SUFFIX}@example.test`, password_hash: "x", full_name: "Outsider", domain_id: OTHER_DOMAIN_ID }).returning();
  OUTSIDER_ID = outsider.user_id;

  const [dept] = await db.insert(departments).values({ department_name: `Integrity Dept ${SUFFIX}`, code: "IG" }).returning();
  DEPT_ID = dept.department_id;

  const [product] = await db.insert(products).values({ product_name: `Integrity Product ${SUFFIX}`, unit_cost: "1", user_id: OWNER_ID, sku_code: `IG-${SUFFIX}` }).returning();
  PRODUCT_ID = product.product_id;
  await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 100 });

  const [outsiderProduct] = await db.insert(products).values({ product_name: `Integrity Outsider Product ${SUFFIX}`, unit_cost: "1", user_id: OUTSIDER_ID, sku_code: `IGO-${SUFFIX}` }).returning();
  OUTSIDER_PRODUCT_ID = outsiderProduct.product_id;
  await db.insert(stocks).values({ product_id: OUTSIDER_PRODUCT_ID, quantity: 50 });
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(inArray(lending_order.issued_by_user_id, [OWNER_ID, OUTSIDER_ID]));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(inArray(lending_order.issued_by_user_id, [OWNER_ID, OUTSIDER_ID]));

  const invoices = await db.select({ id: purchase_invoice.invoice_id }).from(purchase_invoice).where(inArray(purchase_invoice.user_id, [OWNER_ID, OUTSIDER_ID]));
  const invoiceIds = invoices.map((i) => i.id);
  if (invoiceIds.length) await db.delete(purchase_invoice_item).where(inArray(purchase_invoice_item.invoice_id, invoiceIds));
  await db.delete(purchase_invoice).where(inArray(purchase_invoice.user_id, [OWNER_ID, OUTSIDER_ID]));

  await db.delete(stock_ledger).where(inArray(stock_ledger.product_id, [PRODUCT_ID, OUTSIDER_PRODUCT_ID])).catch(() => {});
  await db.delete(stocks).where(inArray(stocks.product_id, [PRODUCT_ID, OUTSIDER_PRODUCT_ID]));
  await db.delete(products).where(inArray(products.product_id, [PRODUCT_ID, OUTSIDER_PRODUCT_ID]));
  await db.delete(students).where(eq(students.department_id, DEPT_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(inArray(users.user_id, [OWNER_ID, OUTSIDER_ID]));
  await db.delete(coe_domains).where(inArray(coe_domains.domain_id, [DOMAIN_ID, OTHER_DOMAIN_ID]));
});

beforeEach(() => {
  mockRequireUser.mockReset();
  actingAs(authedUser());
});

function lendingRequest(body: unknown) {
  return new NextRequest("http://localhost/api/lending", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/lending — stock inflation via a negative quantity", () => {
  it("rejects a negative quantity instead of adding that many units to stock", async () => {
    // The original expression was Math.max(0, stock - quantity). With
    // quantity: -5000 that became Math.max(0, 100 + 5000) and stock jumped to
    // 5100 — an ordinary logged-in user minting inventory at will.
    const before = await quantityOf(PRODUCT_ID);

    const res = await createLending(
      lendingRequest({
        student_id_code: "sit24ig001",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: -5000, item_type: "RETURNABLE" }],
      }),
    );

    expect(res.status).toBe(400);
    expect(await quantityOf(PRODUCT_ID)).toBe(before);
  });

  it("rejects a non-integer quantity", async () => {
    const res = await createLending(
      lendingRequest({
        student_id_code: "sit24ig001",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: 1.5, item_type: "RETURNABLE" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a quantity sent as a string", async () => {
    const res = await createLending(
      lendingRequest({
        student_id_code: "sit24ig001",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: "5", item_type: "RETURNABLE" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses to lend more than is in stock rather than clamping to zero", async () => {
    // Math.max(0, ...) silently wrote 0 and lost the discrepancy forever.
    const before = await quantityOf(PRODUCT_ID);

    const res = await createLending(
      lendingRequest({
        student_id_code: "sit24ig001",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: before + 500, item_type: "RETURNABLE" }],
      }),
    );

    expect(res.status).toBe(409);
    expect(await quantityOf(PRODUCT_ID)).toBe(before);
  });

  it("refuses to lend another COE's product", async () => {
    const before = await quantityOf(OUTSIDER_PRODUCT_ID);

    const res = await createLending(
      lendingRequest({
        student_id_code: "sit24ig001",
        due_date: DUE_DATE,
        lending_items: [{ product_id: OUTSIDER_PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
      }),
    );

    expect(res.status).toBe(404);
    expect(await quantityOf(OUTSIDER_PRODUCT_ID)).toBe(before);
  });
});

describe("PUT /api/lending/[id] — stock inflation via a negative return", () => {
  it("rejects an outstanding quantity above what was issued", async () => {
    // nowReturning = previousOutstanding - quantity, then stock += nowReturning.
    // With one unit outstanding and quantity: -999999 that credited a million
    // units. It needed only a loan the caller had issued themselves.
    const created = await createLending(
      lendingRequest({
        student_id_code: "sit24ig002",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
      }),
    );
    expect(created.status).toBe(201);
    const { order } = (await created.json()) as { order: { lending_order_id: string } };

    const before = await quantityOf(PRODUCT_ID);

    const res = await updateLending(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, {
        method: "PUT",
        body: JSON.stringify({ product_id: PRODUCT_ID, quantity: -999999 }),
      }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );

    expect(res.status).toBe(400);
    expect(await quantityOf(PRODUCT_ID)).toBe(before);
  });

  it("refuses to raise the outstanding balance above what is on loan", async () => {
    const created = await createLending(
      lendingRequest({
        student_id_code: "sit24ig003",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: 2, item_type: "RETURNABLE" }],
      }),
    );
    const { order } = (await created.json()) as { order: { lending_order_id: string } };
    const before = await quantityOf(PRODUCT_ID);

    const res = await updateLending(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, {
        method: "PUT",
        body: JSON.stringify({ product_id: PRODUCT_ID, quantity: 50 }),
      }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );

    expect(res.status).toBe(400);
    expect(await quantityOf(PRODUCT_ID)).toBe(before);
  });

  it("does not accept a client-supplied order status", async () => {
    // `status` was written straight from the body into the enum column, so a
    // client could jump an order to RETURNED without returning anything.
    const created = await createLending(
      lendingRequest({
        student_id_code: "sit24ig004",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
      }),
    );
    const { order } = (await created.json()) as { order: { lending_order_id: string } };

    await updateLending(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "RETURNED" }),
      }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );

    const [row] = await db
      .select({ status: lending_order.status })
      .from(lending_order)
      .where(eq(lending_order.lending_order_id, order.lending_order_id));
    expect(row.status).toBe("PENDING");
  });

  it("only touches the named product's line item", async () => {
    // The fallback branch applied `quantity` to every line item in the order
    // with no product filter.
    const created = await createLending(
      lendingRequest({
        student_id_code: "sit24ig005",
        due_date: DUE_DATE,
        lending_items: [
          { product_id: PRODUCT_ID, quantity: 3, item_type: "RETURNABLE" },
          { product_id: PRODUCT_ID, quantity: 2, item_type: "RETURNABLE" },
        ],
      }),
    );
    expect(created.status).toBe(201);
    const { order } = (await created.json()) as { order: { lending_order_id: string } };

    // Duplicate lines for one product are merged into a single 5-unit item,
    // so a duplicate can't deduct twice against a stale read.
    const items = await db
      .select({ product_id: lending_item.product_id, quantity: lending_item.quantity })
      .from(lending_item)
      .where(eq(lending_item.lend_order_id, order.lending_order_id));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });
});

describe("POST /api/invoices — cross-tenant stock injection", () => {
  it("refuses to restock a product belonging to another COE", async () => {
    // product_id came straight from the request body into an upsert on
    // `stocks` with no ownership check, so any authenticated user could add
    // arbitrary quantities to any other COE's inventory.
    const before = await quantityOf(OUTSIDER_PRODUCT_ID);

    const res = await createInvoice(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: `INJ-${SUFFIX}`,
          supplier_name: "Injection Supplier",
          received_date: "2026-01-01",
          items: [
            { product_id: OUTSIDER_PRODUCT_ID, product_name: "Injected", quantity: 9999, unit_cost: 1, total_cost: 9999 },
          ],
        }),
      }),
    );

    expect(res.status).toBe(404);
    expect(await quantityOf(OUTSIDER_PRODUCT_ID)).toBe(before);
  });

  it("still restocks a product in the caller's own COE", async () => {
    const before = await quantityOf(PRODUCT_ID);

    const res = await createInvoice(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: `OK-${SUFFIX}`,
          supplier_name: "Legit Supplier",
          received_date: "2026-01-01",
          items: [{ product_id: PRODUCT_ID, product_name: "Legit", quantity: 7, unit_cost: 1, total_cost: 7 }],
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(await quantityOf(PRODUCT_ID)).toBe(before + 7);
  });

  it("rejects a negative invoice quantity", async () => {
    const before = await quantityOf(PRODUCT_ID);

    const res = await createInvoice(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: `NEG-${SUFFIX}`,
          supplier_name: "Negative Supplier",
          received_date: "2026-01-01",
          items: [{ product_id: PRODUCT_ID, product_name: "Negative", quantity: -100, unit_cost: 1, total_cost: 1 }],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await quantityOf(PRODUCT_ID)).toBe(before);
  });
});

describe("audit trail", () => {
  it("records who moved stock and why", async () => {
    const created = await createLending(
      lendingRequest({
        student_id_code: "sit24ig006",
        due_date: DUE_DATE,
        lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
      }),
    );
    const { order } = (await created.json()) as { order: { lending_order_id: string } };

    const [entry] = await db
      .select()
      .from(stock_ledger)
      .where(and(eq(stock_ledger.reference_id, order.lending_order_id), eq(stock_ledger.reason, "LEND_ISSUED")));

    expect(entry).toBeDefined();
    expect(entry.actor_user_id).toBe(OWNER_ID);
    expect(entry.quantity_delta).toBe(-1);
  });
});
