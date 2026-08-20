import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { users, category, products, students, departments, lending_order, lending_item } from "@/db/schema";

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
  const [owner] = await db.insert(users).values({ email: `dash-toplent-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Dash Top Lent Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Dash Top Lent Dept" }).returning();
  DEPT_ID = dept.department_id;
  const [borrower] = await db.insert(students).values({ name: "Dash Top Lent Borrower", department_id: DEPT_ID }).returning();
  BORROWER_ID = borrower.student_id;
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(products).where(like(products.product_name, "Dash Top Lent%"));
  await db.delete(category).where(eq(category.category_name, "Dash Top Lent Category"));
  await db.delete(students).where(eq(students.student_id, BORROWER_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/dashboard/top-lent", () => {
  it("returns [] when the owner has no recent orders", async () => {
    actingAs(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/dashboard/top-lent"));
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it("aggregates original_quantity per product across orders, sorted descending", async () => {
    actingAs(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "Dash Top Lent Category" }).returning();
    const [popular] = await db.insert(products).values({ product_name: "Dash Top Lent Popular", unit_cost: "1", category_id: cat.category_id }).returning();
    const [rare] = await db.insert(products).values({ product_name: "Dash Top Lent Rare", unit_cost: "1", category_id: cat.category_id }).returning();

    const [order1] = await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "PENDING" }).returning();
    const [order2] = await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "RETURNED" }).returning();

    await db.insert(lending_item).values({ lend_order_id: order1.lending_order_id, product_id: popular.product_id, quantity: 3, original_quantity: 3 });
    await db.insert(lending_item).values({ lend_order_id: order2.lending_order_id, product_id: popular.product_id, quantity: 0, original_quantity: 5 });
    await db.insert(lending_item).values({ lend_order_id: order1.lending_order_id, product_id: rare.product_id, quantity: 1, original_quantity: 1 });

    const res = await GET(new NextRequest("http://localhost/api/dashboard/top-lent?period=yearly"));
    const body = (await res.json()) as Array<{ product_name: string; total_lent: number }>;
    expect(body[0]).toMatchObject({ product_name: "Dash Top Lent Popular", total_lent: 8 });
    expect(body[1]).toMatchObject({ product_name: "Dash Top Lent Rare", total_lent: 1 });
  });
});
