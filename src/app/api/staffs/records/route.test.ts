import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, staffs, products, category, lending_order, lending_item, users } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;
let OTHER_OWNER_ID: string;

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
    .values({ email: `staffs-records-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Records Owner" })
    .returning();
  OWNER_ID = owner.user_id;
  const [otherOwner] = await db
    .insert(users)
    .values({ email: `staffs-records-other-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Other Owner" })
    .returning();
  OTHER_OWNER_ID = otherOwner.user_id;
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(products).where(eq(products.product_name, "Staff Records Product"));
  await db.delete(category).where(eq(category.category_name, "Staff Records Category"));
  await db.delete(staffs).where(eq(staffs.name, "Records Borrower Staff"));
  await db.delete(departments).where(eq(departments.department_name, "Staff Records Dept"));
  await db.delete(users).where(inArray(users.user_id, [OWNER_ID, OTHER_OWNER_ID]));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/staffs/records", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/staffs/records"));
    expect(res.status).toBe(401);
  });

  it("returns empty records/stats when the owner has no orders in range", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ user_id: OTHER_OWNER_ID }));
    const res = await GET(new NextRequest("http://localhost/api/staffs/records"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: unknown[]; stats: { totalBorrowed: number } };
    expect(body.records).toEqual([]);
    expect(body.stats).toEqual({ totalBorrowed: 0, returned: 0, pending: 0 });
  });

  it("produces one record per lending item, with no placeholder for item-less orders", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());

    const [dept] = await db.insert(departments).values({ department_name: "Staff Records Dept" }).returning();
    const [borrower] = await db.insert(staffs).values({ name: "Records Borrower Staff", department_id: dept.department_id }).returning();
    const [cat] = await db.insert(category).values({ category_name: "Staff Records Category" }).returning();
    const [product] = await db.insert(products).values({ product_name: "Staff Records Product", category_id: cat.category_id }).returning();

    // Order with an item: should produce a record.
    const [orderWithItem] = await db
      .insert(lending_order)
      .values({ borrower_type: "STAFF", borrower_staff_id: borrower.staff_id, issued_by_user_id: OWNER_ID, status: "RETURNED" })
      .returning();
    await db.insert(lending_item).values({ lend_order_id: orderWithItem.lending_order_id, product_id: product.product_id, quantity: 2 });

    // Order with no items: should NOT produce a placeholder (matches original staffs/records behavior).
    await db.insert(lending_order).values({ borrower_type: "STAFF", borrower_staff_id: borrower.staff_id, issued_by_user_id: OWNER_ID, status: "PENDING" });

    const res = await GET(new NextRequest("http://localhost/api/staffs/records?period=yearly"));
    const body = (await res.json()) as { records: Array<Record<string, unknown>>; stats: { totalBorrowed: number; returned: number; pending: number } };

    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({
      staff_name: "Records Borrower Staff",
      department: "Staff Records Dept",
      product_name: "Staff Records Product",
      quantity: 2,
      return_date: null,
    });
    // Both orders belong to the same borrower staff member: 1 borrowed, 1 returned, 1 pending.
    expect(body.stats).toEqual({ totalBorrowed: 1, returned: 1, pending: 1 });
  });
});
