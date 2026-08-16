import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, products, category, stocks, purchase_invoice, purchase_invoice_item } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET, DELETE } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;
let PRODUCT_ID: string;

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: OWNER_ID,
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

async function makeInvoice(quantity: number) {
  const [invoice] = await db
    .insert(purchase_invoice)
    .values({ invoice_number: "INV-ID-TEST", supplier_name: "Invoices Id Supplier", received_date: "2026-01-01", total_amount: "10", user_id: OWNER_ID })
    .returning();
  await db.insert(purchase_invoice_item).values({ invoice_id: invoice.invoice_id, product_id: PRODUCT_ID, product_name: "Invoices Id Product", quantity, unit_cost: "1", total_cost: String(quantity) });
  return invoice;
}

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `invoices-id-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Invoices Id Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [cat] = await db.insert(category).values({ category_name: "Invoices Id Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Invoices Id Product", unit_cost: "1", category_id: cat.category_id }).returning();
  PRODUCT_ID = product.product_id;
});

beforeEach(async () => {
  mockGetAuthUser.mockReset();
  await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 10 }).onConflictDoUpdate({ target: stocks.product_id, set: { quantity: 10 } });
});

afterAll(async () => {
  await db.delete(purchase_invoice_item).where(eq(purchase_invoice_item.product_id, PRODUCT_ID));
  await db.delete(purchase_invoice).where(eq(purchase_invoice.user_id, OWNER_ID));
  await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(category).where(eq(category.category_name, "Invoices Id Category"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

describe("GET /api/invoices/[id]", () => {
  it("returns 404 for an invoice owned by someone else", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/invoices/x"), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(res.status).toBe(404);
  });

  it("returns the invoice with its items, falling back to product_name when unlinked", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const invoice = await makeInvoice(3);

    const res = await GET(new NextRequest(`http://localhost/api/invoices/${invoice.invoice_id}`), { params: Promise.resolve({ id: invoice.invoice_id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ product_name: string; quantity: number }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ product_name: "Invoices Id Product", quantity: 3 });
  });
});

describe("DELETE /api/invoices/[id]", () => {
  it("deletes the invoice and restores stock", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const invoice = await makeInvoice(4);

    const res = await DELETE(new NextRequest(`http://localhost/api/invoices/${invoice.invoice_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: invoice.invoice_id }),
    });
    expect(res.status).toBe(200);

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(6); // 10 - 4

    const [remaining] = await db.select().from(purchase_invoice).where(eq(purchase_invoice.invoice_id, invoice.invoice_id));
    expect(remaining).toBeUndefined();
  });
});
