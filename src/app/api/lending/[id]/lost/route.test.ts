import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, departments, products, category, stocks, students, lending_order, lending_item } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { POST } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}
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

async function makeOrderWithItem(quantity: number) {
  const [order] = await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "PENDING" }).returning();
  await db.insert(lending_item).values({ lend_order_id: order.lending_order_id, product_id: PRODUCT_ID, quantity, original_quantity: quantity });
  return order;
}

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `lending-lost-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Lending Lost Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Lending Lost Dept" }).returning();
  DEPT_ID = dept.department_id;
  const [borrower] = await db.insert(students).values({ name: "Lending Lost Borrower", department_id: DEPT_ID }).returning();
  BORROWER_ID = borrower.student_id;
  const [cat] = await db.insert(category).values({ category_name: "Lending Lost Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Lending Lost Product", unit_cost: "1", category_id: cat.category_id }).returning();
  PRODUCT_ID = product.product_id;
});

beforeEach(async () => {
  mockRequireUser.mockReset();
  await db
    .insert(stocks)
    .values({ product_id: PRODUCT_ID, quantity: 10, lost_quantity: 0 })
    .onConflictDoUpdate({ target: stocks.product_id, set: { quantity: 10, damaged_quantity: 0, lost_quantity: 0 } });
});

afterAll(async () => {
  await db.delete(lending_item).where(eq(lending_item.product_id, PRODUCT_ID));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(category).where(eq(category.category_name, "Lending Lost Category"));
  await db.delete(students).where(eq(students.student_id, BORROWER_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

describe("POST /api/lending/[id]/lost", () => {
  it("returns 400 when lost_quantity exceeds the lent quantity", async () => {
    actingAs(authedUser());
    const order = await makeOrderWithItem(2);
    const res = await POST(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}/lost`, { method: "POST", body: JSON.stringify({ product_id: PRODUCT_ID, lost_quantity: 5 }) }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );
    expect(res.status).toBe(400);
  });

  it("partial loss: sets order status PARTIALLY_LOST and updates stock", async () => {
    actingAs(authedUser());
    const order = await makeOrderWithItem(5);

    const res = await POST(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}/lost`, { method: "POST", body: JSON.stringify({ product_id: PRODUCT_ID, lost_quantity: 2 }) }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orderStatus: string; newStockQuantity: number; newLostQuantity: number };
    expect(body.orderStatus).toBe("PARTIALLY_LOST");
    // Shelf quantity is unchanged, not 8. These units left the shelf when the
    // loan was issued; the old route decremented stocks.quantity a second
    // time here, so every loss was counted out of inventory twice — and the
    // dashboard then added it back once as available + lent + damaged + lost.
    expect(body.newStockQuantity).toBe(10);
    expect(body.newLostQuantity).toBe(2);
  });

  it("full loss: sets order status LOST", async () => {
    actingAs(authedUser());
    const order = await makeOrderWithItem(3);

    const res = await POST(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}/lost`, { method: "POST", body: JSON.stringify({ product_id: PRODUCT_ID, lost_quantity: 3 }) }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );
    const body = (await res.json()) as { orderStatus: string };
    expect(body.orderStatus).toBe("LOST");
  });
});
