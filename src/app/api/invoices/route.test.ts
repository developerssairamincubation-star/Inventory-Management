import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, products, category, stocks, purchase_invoice, purchase_invoice_item } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET, POST } from "./route";

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
    ...overrides,
  };
}

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `invoices-route-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Invoices Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [cat] = await db.insert(category).values({ category_name: "Invoices Route Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Invoices Route Product", unit_cost: "1", category_id: cat.category_id }).returning();
  PRODUCT_ID = product.product_id;
});

afterAll(async () => {
  const invoices = await db.select({ id: purchase_invoice.invoice_id }).from(purchase_invoice).where(eq(purchase_invoice.user_id, OWNER_ID));
  const invoiceIds = invoices.map((i) => i.id);
  if (invoiceIds.length) await db.delete(purchase_invoice_item).where(inArray(purchase_invoice_item.invoice_id, invoiceIds));
  await db.delete(purchase_invoice).where(eq(purchase_invoice.user_id, OWNER_ID));
  await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(category).where(eq(category.category_name, "Invoices Route Category"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/invoices", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/invoices"));
    expect(res.status).toBe(401);
  });

  it("returns an empty list when the user has no invoices", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/invoices"));
    const body = (await res.json()) as { invoices: unknown[] };
    expect(body.invoices).toEqual([]);
  });
});

describe("POST /api/invoices", () => {
  it("returns 400 when required fields are missing", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/invoices", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("creates an invoice+items and increments existing stock for matched products", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 5 });

    const res = await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-TEST-001",
          supplier_name: "Invoices Route Supplier",
          received_date: "2026-01-01",
          items: [{ product_id: PRODUCT_ID, product_name: "Invoices Route Product", quantity: 10, unit_cost: 2, total_cost: 20 }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: { invoice_id: string; total_amount: string } };
    expect(Number(body.invoice.total_amount)).toBe(20);

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(15);
  });
});
