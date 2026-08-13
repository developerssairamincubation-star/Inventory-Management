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
import { GET } from "./route";

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

beforeAll(async () => {
  const [owner] = await db
    .insert(users)
    .values({ email: `stocks-id-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Stocks Id Owner" })
    .returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  const prodRows = await db.select({ id: products.product_id }).from(products).where(like(products.product_name, "Stocks Id%"));
  const prodIds = prodRows.map((p) => p.id);
  if (prodIds.length) await db.delete(stocks).where(inArray(stocks.product_id, prodIds));
  await db.delete(products).where(like(products.product_name, "Stocks Id%"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/stocks/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/stocks/x"), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("returns the quantity for a product's stock row", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [product] = await db.insert(products).values({ product_name: "Stocks Id Widget", unit_cost: "1", user_id: OWNER_ID }).returning();
    await db.insert(stocks).values({ product_id: product.product_id, quantity: 7 });

    const res = await GET(new NextRequest(`http://localhost/api/stocks/${product.product_id}`), { params: Promise.resolve({ id: product.product_id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quantity: number };
    expect(body.quantity).toBe(7);
  });
});
