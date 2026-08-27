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
  // Not just the fixture: the atomicity tests create products through the
  // route itself, and they are owned by OWNER_ID like everything else here.
  // Leaving them behind made a second run of this file see six "Atomic New"
  // rows where it expected two.
  const owned = await db.select({ id: products.product_id }).from(products).where(eq(products.user_id, OWNER_ID));
  const ownedIds = owned.map((p) => p.id);
  if (ownedIds.length) {
    await db.delete(stocks).where(inArray(stocks.product_id, ownedIds));
    await db.delete(products).where(inArray(products.product_id, ownedIds));
  }
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

  // ── Atomicity ──────────────────────────────────────────────────────────
  //
  // The upload UI used to create each new product with its own
  // POST /api/products call before posting the invoice. A failure part-way
  // through left those products committed with no invoice, and pressing Save
  // again created them a second time — a 22-line invoice could leave 21
  // orphans behind. Product creation now happens inside this route's
  // transaction; these two tests are what stop that regressing.

  it("creates new products inside the invoice's own transaction", async () => {
    actingAs(authedUser());

    const res = await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-ATOMIC-OK",
          supplier_name: "Atomic Supplier",
          received_date: "2026-01-01",
          items: [
            { product_name: "Atomic New A", quantity: 7, unit_cost: 12.5, total_cost: 87.5, location: "R2", new_product: {} },
            { product_name: "Atomic New B", quantity: 3, unit_cost: 4.25, total_cost: 12.75, new_product: {} },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);

    const created = await db
      .select({ id: products.product_id, name: products.product_name })
      .from(products)
      .where(inArray(products.product_name, ["Atomic New A", "Atomic New B"]));
    expect(created).toHaveLength(2);

    // Opening stock is 0 and the invoice's own quantity supplies the balance,
    // so a double-count would show up here as 14 rather than 7.
    const a = created.find((p) => p.name === "Atomic New A")!;
    const [stockA] = await db.select({ quantity: stocks.quantity, location: stocks.location }).from(stocks).where(eq(stocks.product_id, a.id));
    expect(stockA.quantity).toBe(7);
    expect(stockA.location).toBe("R2");

    // The line item must point at the product the transaction created, not null.
    const [invoiceRow] = await db.select({ id: purchase_invoice.invoice_id }).from(purchase_invoice).where(eq(purchase_invoice.invoice_number, "INV-ATOMIC-OK"));
    const lines = await db.select({ product_id: purchase_invoice_item.product_id }).from(purchase_invoice_item).where(eq(purchase_invoice_item.invoice_id, invoiceRow.id));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.product_id !== null)).toBe(true);
  });

  it("leaves nothing behind when a later line fails", async () => {
    actingAs(authedUser());

    const res = await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-ATOMIC-FAIL",
          supplier_name: "Atomic Supplier",
          received_date: "2026-01-01",
          items: [
            { product_name: "Rollback A", quantity: 2, unit_cost: 10, total_cost: 20, new_product: {} },
            { product_name: "Rollback B", quantity: 1, unit_cost: 5, total_cost: 5, new_product: {} },
            // Valid UUID, no such category — so this throws inside the
            // transaction, after A and B have already been inserted.
            { product_name: "Rollback C", quantity: 1, unit_cost: 5, total_cost: 5, new_product: { category_id: "550e8400-e29b-41d4-a716-446655440000" } },
          ],
        }),
      }),
    );
    expect(res.ok).toBe(false);

    // The message names the offending line, so a long invoice doesn't force
    // the user to guess which row the server objected to.
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Line 3");
    expect(body.error.message).toContain("Rollback C");

    const survivors = await db
      .select({ id: products.product_id })
      .from(products)
      .where(inArray(products.product_name, ["Rollback A", "Rollback B", "Rollback C"]));
    expect(survivors).toHaveLength(0);

    const invoices = await db.select({ id: purchase_invoice.invoice_id }).from(purchase_invoice).where(eq(purchase_invoice.invoice_number, "INV-ATOMIC-FAIL"));
    expect(invoices).toHaveLength(0);
  });

  it("rejects money with more than two decimal places, naming the line", async () => {
    actingAs(authedUser());

    const res = await POST(
      new NextRequest("http://localhost/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_number: "INV-PRECISION",
          supplier_name: "Atomic Supplier",
          received_date: "2026-01-01",
          items: [
            { product_name: "Fine", quantity: 1, unit_cost: 10.5, total_cost: 10.5, new_product: {} },
            { product_name: "Too precise", quantity: 1, unit_cost: 33.333, total_cost: 33.33, new_product: {} },
          ],
        }),
      }),
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { message: string; details: Array<{ detail: string }> } };
    // numeric(12,2) genuinely cannot hold it, so rejecting is right — but the
    // message has to say which line and what to do about it.
    expect(body.error.message).toContain("Line 2");
    expect(body.error.message).toContain("2 decimal places");
    expect(body.error.details[0].detail).toContain("unit cost");
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
