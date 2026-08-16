import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { products, stocks, product_image, category, users } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET, POST } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;

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
  const [owner] = await db
    .insert(users)
    .values({ email: `products-route-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Products Owner" })
    .returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  const rows = await db.select({ id: products.product_id }).from(products).where(eq(products.user_id, OWNER_ID));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(stocks).where(inArray(stocks.product_id, ids));
    await db.delete(product_image).where(inArray(product_image.product_id, ids));
    await db.delete(products).where(inArray(products.product_id, ids));
  }
  await db.delete(category).where(eq(category.category_name, "Products Route Category"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/products", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/products"));
    expect(res.status).toBe(401);
  });

  it("only returns products owned by the authenticated user, with flattened image_url/category_name", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "Products Route Category" }).returning();
    const [product] = await db
      .insert(products)
      .values({ product_name: "Products Route Widget", unit_cost: "9.99", user_id: OWNER_ID, category_id: cat.category_id })
      .returning();
    await db.insert(stocks).values({ product_id: product.product_id, quantity: 5 });
    await db.insert(product_image).values({ product_id: product.product_id, image_url: "http://example.com/widget.png" });

    const res = await GET(new NextRequest("http://localhost/api/products"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ product_name: string; image_url: string; category_name: string; stocks: { quantity: number } | null }>;
    const widget = body.find((p) => p.product_name === "Products Route Widget");
    // Regression test: an earlier version of this route dropped the stocks
    // join entirely, so every product silently showed no quantity in the
    // list view — caught via manual browser testing, not by this suite,
    // since the original assertion here never checked `stocks` at all.
    expect(widget).toMatchObject({ image_url: "http://example.com/widget.png", category_name: "Products Route Category", stocks: { quantity: 5 } });
  });
});

describe("POST /api/products", () => {
  it("returns 400 when required fields are missing", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/products", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("creates a product+stock atomically with a sequential STIC product_code", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ product_name: "Products Route New", unit_cost: 12.5, quantity: 4 }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { product: { product_code: string; product_name: string }; stock: { quantity: number } };
    expect(body.product.product_code).toMatch(/^STIC\d{3}$/);
    expect(body.stock.quantity).toBe(4);
  });

  it("backfills a unique SKU prefix (not the shared GEN fallback) for a category with no code, and persists it", async () => {
    // Regression test: two categories that both lack a code must never both
    // fall back to the literal "GEN" — that's also the uncategorized-product
    // prefix, so two such categories would generate colliding SKUs for
    // different products (this happened before this fix).
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [catA] = await db.insert(category).values({ category_name: "Products Route NoCode Alpha" }).returning();
    const [catB] = await db.insert(category).values({ category_name: "Products Route NoCode Beta" }).returning();

    const resA = await POST(new NextRequest("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ product_name: "Products Route NoCode A", unit_cost: 1, quantity: 1, category_id: catA.category_id }),
    }));
    const resB = await POST(new NextRequest("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ product_name: "Products Route NoCode B", unit_cost: 1, quantity: 1, category_id: catB.category_id }),
    }));
    const bodyA = (await resA.json()) as { product: { sku_code: string } };
    const bodyB = (await resB.json()) as { product: { sku_code: string } };

    expect(bodyA.product.sku_code).not.toMatch(/^GEN-/);
    expect(bodyB.product.sku_code).not.toMatch(/^GEN-/);
    // Different categories must never end up with the same prefix.
    expect(bodyA.product.sku_code.split("-")[0]).not.toBe(bodyB.product.sku_code.split("-")[0]);

    const [updatedCatA] = await db.select({ code: category.code }).from(category).where(eq(category.category_id, catA.category_id));
    expect(updatedCatA.code).not.toBeNull();
    expect(updatedCatA.code).not.toBe("GEN");

    await db.delete(category).where(eq(category.category_id, catA.category_id));
    await db.delete(category).where(eq(category.category_id, catB.category_id));
  });

  it("never allocates the same product_code twice under concurrent creation", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        POST(
          new NextRequest("http://localhost/api/products", {
            method: "POST",
            body: JSON.stringify({ product_name: `Products Route Concurrent ${i}`, unit_cost: 1, quantity: 1 }),
          }),
        ),
      ),
    );
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{ product: { product_code: string } }>;
    const codes = bodies.map((b) => b.product.product_code);
    expect(new Set(codes).size).toBe(5);
  });
});
