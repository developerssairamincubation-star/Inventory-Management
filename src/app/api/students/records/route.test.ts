import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { students, departments, staffs, products, category, lending_order, lending_item, users } from "@/db/schema";

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
  const [owner] = await db
    .insert(users)
    .values({ email: `students-records-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Records Owner" })
    .returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(products).where(eq(products.product_name, "Records Product"));
  await db.delete(category).where(eq(category.category_name, "Records Category"));
  await db.delete(staffs).where(eq(staffs.name, "Records Mentor"));
  await db.delete(students).where(eq(students.name, "Records Student"));
  await db.delete(departments).where(eq(departments.department_name, "Records Dept"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/students/records", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/students/records"));
    expect(res.status).toBe(401);
  });

  it("builds one record per lending item, joined with student/department/mentor/product names", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());

    const [dept] = await db.insert(departments).values({ department_name: "Records Dept" }).returning();
    const [student] = await db.insert(students).values({ name: "Records Student", department_id: dept.department_id }).returning();
    const [mentor] = await db.insert(staffs).values({ name: "Records Mentor", department_id: dept.department_id }).returning();
    const [cat] = await db.insert(category).values({ category_name: "Records Category" }).returning();
    const [product] = await db.insert(products).values({ product_name: "Records Product", category_id: cat.category_id }).returning();

    const [order] = await db
      .insert(lending_order)
      .values({
        borrower_type: "STUDENT",
        borrower_student_id: student.student_id,
        issued_by_user_id: OWNER_ID,
        mentor_staff_id: mentor.staff_id,
        status: "PENDING",
      })
      .returning();

    await db.insert(lending_item).values({
      lend_order_id: order.lending_order_id,
      product_id: product.product_id,
      quantity: 3,
      original_quantity: 3,
    });

    const res = await GET(new NextRequest("http://localhost/api/students/records?period=yearly"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: Array<Record<string, unknown>>; stats: { totalBorrowed: number } };

    const record = body.records.find((r) => r.student_id === student.student_id);
    expect(record).toMatchObject({
      student_name: "Records Student",
      department: "Records Dept",
      mentor: "Records Mentor",
      product_name: "Records Product",
      quantity: 3,
      status: "PENDING",
    });
    expect(body.stats.totalBorrowed).toBeGreaterThanOrEqual(1);
  });
});
