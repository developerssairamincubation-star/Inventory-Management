import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { products, stocks, users } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { PATCH } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;

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

async function makeProduct(name: string, quantity = 10) {
  const [product] = await db.insert(products).values({ product_name: name, unit_cost: "5.00", user_id: OWNER_ID }).returning();
  await db.insert(stocks).values({ product_id: product.product_id, quantity });
  return product;
}

beforeAll(async () => {
  const [owner] = await db
    .insert(users)
    .values({ email: `update-stock-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Update Stock Owner" })
    .returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  const prodRows = await db.select({ id: products.product_id }).from(products).where(like(products.product_name, "Update Stock%"));
  const prodIds = prodRows.map((p) => p.id);
  if (prodIds.length) await db.delete(stocks).where(inArray(stocks.product_id, prodIds));
  await db.delete(products).where(like(products.product_name, "Update Stock%"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("PATCH /api/products/[id]/update-stock", () => {
  it("returns 400 for a negative additionalStock value", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Update Stock Invalid");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/products/${product.product_id}/update-stock`, { method: "PATCH", body: JSON.stringify({ additionalStock: -1 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(400);
  });

  it("adds additionalStock to the current quantity", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Update Stock Add", 10);
    const res = await PATCH(
      new NextRequest(`http://localhost/api/products/${product.product_id}/update-stock`, { method: "PATCH", body: JSON.stringify({ additionalStock: 5 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { stocks: { quantity: number } } };
    expect(body.product.stocks.quantity).toBe(15);
  });

  it("sets an absolute newStock value and updates unitCost", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Update Stock Set", 10);
    const res = await PATCH(
      new NextRequest(`http://localhost/api/products/${product.product_id}/update-stock`, { method: "PATCH", body: JSON.stringify({ newStock: 42, unitCost: 7.5 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { stocks: { quantity: number }; unit_cost: string } };
    expect(body.product.stocks.quantity).toBe(42);
    expect(Number(body.product.unit_cost)).toBe(7.5);
  });
});
