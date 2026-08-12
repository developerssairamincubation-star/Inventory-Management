import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, departments, products, category, stocks, students, staffs, lending_order, lending_item } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET, POST } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;
let DEPT_ID: string;
let PRODUCT_ID: string;

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
  const [owner] = await db.insert(users).values({ email: `lending-route-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Lending Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Lending Route Dept" }).returning();
  DEPT_ID = dept.department_id;
  const [cat] = await db.insert(category).values({ category_name: "Lending Route Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Lending Route Product", unit_cost: "1", category_id: cat.category_id }).returning();
  PRODUCT_ID = product.product_id;
  await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 20 });
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(category).where(eq(category.category_name, "Lending Route Category"));
  await db.delete(students).where(eq(students.department_id, DEPT_ID));
  await db.delete(staffs).where(eq(staffs.department_id, DEPT_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/lending", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/lending"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/lending", () => {
  it("creates a new student borrower, order, items, and decrements stock atomically", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());

    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          borrower_type: "STUDENT",
          borrower_name: "Lending Route New Student",
          department_id: DEPT_ID,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 3 }],
          status: "PENDING",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { order: { lending_order_id: string; status: string }; items: Array<{ quantity: number }> };
    expect(body.items[0].quantity).toBe(3);

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(17);

    const [student] = await db.select().from(students).where(eq(students.name, "Lending Route New Student"));
    expect(student).toBeDefined();
  });

  it("reuses an existing borrower with the same name+department instead of creating a duplicate", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [existing] = await db.insert(students).values({ name: "Lending Route Existing Student", department_id: DEPT_ID }).returning();

    await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          borrower_type: "STUDENT",
          borrower_name: "Lending Route Existing Student",
          department_id: DEPT_ID,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1 }],
          status: "PENDING",
        }),
      }),
    );

    const matches = await db.select().from(students).where(eq(students.name, "Lending Route Existing Student"));
    expect(matches).toHaveLength(1);
    expect(matches[0].student_id).toBe(existing.student_id);
  });
});
