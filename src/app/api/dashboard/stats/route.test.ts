import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, category, products, stocks, students, departments, lending_order, lending_item } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { GET } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}
let OWNER_ID: string;
let DEPT_ID: string;
let BORROWER_ID: string;

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
  const [owner] = await db.insert(users).values({ email: `dash-stats-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Dash Stats Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Dash Stats Dept" }).returning();
  DEPT_ID = dept.department_id;
  const [borrower] = await db.insert(students).values({ name: "Dash Stats Borrower", department_id: DEPT_ID }).returning();
  BORROWER_ID = borrower.student_id;
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const prodRows = await db.select({ id: products.product_id }).from(products).where(eq(products.user_id, OWNER_ID));
  const prodIds = prodRows.map((p) => p.id);
  if (prodIds.length) await db.delete(stocks).where(inArray(stocks.product_id, prodIds));
  await db.delete(products).where(eq(products.user_id, OWNER_ID));
  await db.delete(category).where(eq(category.category_name, "Dash Stats Category"));
  await db.delete(students).where(eq(students.student_id, BORROWER_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/dashboard/stats", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await GET(new NextRequest("http://localhost/api/dashboard/stats"));
    expect(res.status).toBe(401);
  });

  it("computes totals scoped to the authenticated owner's products/orders, excluding the dead ACTIVE status", async () => {
    actingAs(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "Dash Stats Category" }).returning();
    const [product] = await db.insert(products).values({ product_name: "Dash Stats Product", unit_cost: "1", user_id: OWNER_ID, category_id: cat.category_id }).returning();
    await db.insert(stocks).values({ product_id: product.product_id, quantity: 3, damaged_quantity: 1, lost_quantity: 1 });

    const [order] = await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "PENDING" }).returning();
    await db.insert(lending_item).values({ lend_order_id: order.lending_order_id, product_id: product.product_id, quantity: 2, original_quantity: 2 });

    const res = await GET(new NextRequest("http://localhost/api/dashboard/stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalProducts: number; stockDistribution: { lent: number; available: number; lostDamaged: number; lost: number } };
    expect(body.totalProducts).toBe(1);
    expect(body.stockDistribution).toMatchObject({ lent: 2, available: 3, lostDamaged: 1, lost: 1 });
  });
});
