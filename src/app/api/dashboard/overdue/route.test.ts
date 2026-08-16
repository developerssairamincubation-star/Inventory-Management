import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, category, products, students, departments, lending_order, lending_item } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;
let DEPT_ID: string;
let BORROWER_ID: string;
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
  const [owner] = await db.insert(users).values({ email: `dash-overdue-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Dash Overdue Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Dash Overdue Dept" }).returning();
  DEPT_ID = dept.department_id;
  const [borrower] = await db.insert(students).values({ name: "Dash Overdue Borrower", department_id: DEPT_ID }).returning();
  BORROWER_ID = borrower.student_id;
  const [cat] = await db.insert(category).values({ category_name: "Dash Overdue Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Dash Overdue Product", unit_cost: "1", category_id: cat.category_id }).returning();
  PRODUCT_ID = product.product_id;
});

afterAll(async () => {
  await db.delete(lending_item).where(eq(lending_item.product_id, PRODUCT_ID));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(category).where(eq(category.category_name, "Dash Overdue Category"));
  await db.delete(students).where(eq(students.student_id, BORROWER_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/dashboard/overdue", () => {
  it("returns [] when there are no overdue orders", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/dashboard/overdue"));
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it("only flags PENDING orders past their due_date, joined with borrower/product names", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const pastDue = "2020-01-01";
    const [overdue] = await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "PENDING", due_date: pastDue }).returning();
    await db.insert(lending_item).values({ lend_order_id: overdue.lending_order_id, product_id: PRODUCT_ID, quantity: 1 });

    // Not overdue: due_date in the future.
    const future = "2099-01-01";
    await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "PENDING", due_date: future });

    // Past due but already RETURNED: should not appear.
    await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "RETURNED", due_date: pastDue });

    const res = await GET(new NextRequest("http://localhost/api/dashboard/overdue"));
    const body = (await res.json()) as Array<{ lending_order_id: string; borrower_name: string; product_name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ lending_order_id: overdue.lending_order_id, borrower_name: "Dash Overdue Borrower", product_name: "Dash Overdue Product" });
  });
});
