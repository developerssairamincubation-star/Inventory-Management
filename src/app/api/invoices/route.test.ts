import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, products, category, stocks, purchase_invoice, purchase_invoice_item } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { GET, POST } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}
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

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `invoices-route-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Invoices Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [cat] = await db.insert(category).values({ category_name: "Invoices Route Category" }).returning();
  // Invoice line items may only restock products the caller can see, so the
  // fixture product needs a real owner — an ownerless product resolves to no
  // domain and is now correctly invisible.
  const [product] = await db.insert(products).values({ product_name: "Invoices Route Product", unit_cost: "1", category_id: cat.category_id, user_id: OWNER_ID }).returning();
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
  mockRequireUser.mockReset();
});

describe("GET /api/invoices", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await GET(new NextRequest("http://localhost/api/invoices"));
    expect(res.status).toBe(401);
  });

  it("returns an empty list when the user has no invoices", async () => {
    actingAs(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/invoices"));
    const body = (await res.json()) as { invoices: unknown[] };
    expect(body.invoices).toEqual([]);
  });
});

describe("POST /api/invoices", () => {
  it("returns 400 when required fields are missing", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/invoices", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("creates an invoice+items and increments existing stock for matched products", async () => {
    actingAs(authedUser());
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
    // 201, not 200 — this creates a resource. Clients branch on res.ok, so the
    // change is invisible to them.
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: { invoice_id: string; total_amount: string } };
    expect(Number(body.invoice.total_amount)).toBe(20);

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(15);
  });

  it("sets the stock's location from a line item, and leaves it untouched on a later restock with no location", async () => {
    actingAs(authedUser());
    // A prior test in this file may already have a stocks row for PRODUCT_ID
    // (stocks.product_id is unique) — reset to a known baseline instead of
    // assuming this test runs first.
    await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 5 });

    await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-TEST-LOC-1",
          supplier_name: "Invoices Route Supplier",
          received_date: "2026-01-01",
          items: [{ product_id: PRODUCT_ID, product_name: "Invoices Route Product", quantity: 3, unit_cost: 2, total_cost: 6, location: " R2 " }],
        }),
      }),
    );
    let [stock] = await db.select({ quantity: stocks.quantity, location: stocks.location }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.location).toBe("R2");
    expect(stock.quantity).toBe(8);

    await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-TEST-LOC-2",
          supplier_name: "Invoices Route Supplier",
          received_date: "2026-01-02",
          items: [{ product_id: PRODUCT_ID, product_name: "Invoices Route Product", quantity: 2, unit_cost: 2, total_cost: 4 }],
        }),
      }),
    );
    ;[stock] = await db.select({ quantity: stocks.quantity, location: stocks.location }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.location).toBe("R2");
    expect(stock.quantity).toBe(10);
  });
});

describe("GET /api/invoices — super_admin visibility", () => {
  it("returns invoices from every user, with owner_name, when the caller is super_admin", async () => {
    actingAs(authedUser());
    await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-TEST-ADMIN-VIS",
          supplier_name: "Invoices Route Supplier",
          received_date: "2026-01-03",
          items: [{ product_id: null, product_name: "Invoice-only item", quantity: 1, unit_cost: 1, total_cost: 1 }],
        }),
      }),
    );

    actingAs(authedUser({ user_id: "00000000-0000-0000-0000-000000000000", role: "super_admin" }));
    const res = await GET(new NextRequest("http://localhost/api/invoices"));
    const body = (await res.json()) as { invoices: Array<{ invoice_number: string; owner_name: string | null }> };
    const created = body.invoices.find((i) => i.invoice_number === "INV-TEST-ADMIN-VIS");
    expect(created).toBeTruthy();
    expect(created?.owner_name).toBe("Invoices Owner");
  });
});
