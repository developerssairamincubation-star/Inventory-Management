import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, category, products, stocks } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: OWNER_ID,
    firebase_uid: "fb-1",
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    ...overrides,
  };
}

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `dash-lowstock-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Dash Low Stock Owner" }).returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  const prodRows = await db.select({ id: products.product_id }).from(products).where(eq(products.user_id, OWNER_ID));
  const prodIds = prodRows.map((p) => p.id);
  if (prodIds.length) await db.delete(stocks).where(inArray(stocks.product_id, prodIds));
  await db.delete(products).where(eq(products.user_id, OWNER_ID));
  await db.delete(category).where(eq(category.category_name, "Dash Low Stock Category"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/dashboard/low-stock", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/dashboard/low-stock"));
    expect(res.status).toBe(401);
  });

  it("only includes products at/below their threshold, excludes products with no threshold", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "Dash Low Stock Category" }).returning();

    const [low] = await db.insert(products).values({ product_name: "Dash Low Stock Below", unit_cost: "1", user_id: OWNER_ID, category_id: cat.category_id, low_stock_threshold: 5 }).returning();
    await db.insert(stocks).values({ product_id: low.product_id, quantity: 2 });

    const [ok] = await db.insert(products).values({ product_name: "Dash Low Stock Above", unit_cost: "1", user_id: OWNER_ID, category_id: cat.category_id, low_stock_threshold: 5 }).returning();
    await db.insert(stocks).values({ product_id: ok.product_id, quantity: 50 });

    const [noThreshold] = await db.insert(products).values({ product_name: "Dash Low Stock NoThreshold", unit_cost: "1", user_id: OWNER_ID, category_id: cat.category_id, low_stock_threshold: 0 }).returning();
    await db.insert(stocks).values({ product_id: noThreshold.product_id, quantity: 1 });

    const res = await GET(new NextRequest("http://localhost/api/dashboard/low-stock"));
    const body = (await res.json()) as Array<{ product_name: string; current_stock: number }>;
    const names = body.map((p) => p.product_name);
    expect(names).toContain("Dash Low Stock Below");
    expect(names).not.toContain("Dash Low Stock Above");
    expect(names).not.toContain("Dash Low Stock NoThreshold");
  });
});
