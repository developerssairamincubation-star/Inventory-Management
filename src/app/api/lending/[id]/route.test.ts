import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, departments, products, category, stocks, students, lending_order, lending_item } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { PUT, DELETE } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;
let DEPT_ID: string;
let PRODUCT_ID: string;
let CONSUMABLE_PRODUCT_ID: string;
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

async function makeOrderWithItem(quantity: number, itemType: "RETURNABLE" | "CONSUMABLE" = "RETURNABLE", productId: string = PRODUCT_ID) {
  const [order] = await db.insert(lending_order).values({ borrower_type: "STUDENT", borrower_student_id: BORROWER_ID, issued_by_user_id: OWNER_ID, status: "PENDING" }).returning();
  await db.insert(lending_item).values({ lend_order_id: order.lending_order_id, product_id: productId, quantity, original_quantity: quantity, item_type: itemType });
  return order;
}

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `lending-id-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Lending Id Owner" }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Lending Id Dept" }).returning();
  DEPT_ID = dept.department_id;
  const [borrower] = await db.insert(students).values({ name: "Lending Id Borrower", department_id: DEPT_ID }).returning();
  BORROWER_ID = borrower.student_id;
  const [cat] = await db.insert(category).values({ category_name: "Lending Id Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Lending Id Product", unit_cost: "1", category_id: cat.category_id }).returning();
  PRODUCT_ID = product.product_id;
  const [consumableProduct] = await db.insert(products).values({ product_name: "Lending Id Consumable", unit_cost: "1", category_id: cat.category_id }).returning();
  CONSUMABLE_PRODUCT_ID = consumableProduct.product_id;
});

beforeEach(async () => {
  mockGetAuthUser.mockReset();
  await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 10 }).onConflictDoUpdate({ target: stocks.product_id, set: { quantity: 10, damaged_quantity: 0, lost_quantity: 0 } });
  await db.insert(stocks).values({ product_id: CONSUMABLE_PRODUCT_ID, quantity: 10 }).onConflictDoUpdate({ target: stocks.product_id, set: { quantity: 10, damaged_quantity: 0, lost_quantity: 0 } });
});

afterAll(async () => {
  await db.delete(lending_item).where(eq(lending_item.product_id, PRODUCT_ID));
  await db.delete(lending_item).where(eq(lending_item.product_id, CONSUMABLE_PRODUCT_ID));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(stocks).where(eq(stocks.product_id, PRODUCT_ID));
  await db.delete(stocks).where(eq(stocks.product_id, CONSUMABLE_PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, PRODUCT_ID));
  await db.delete(products).where(eq(products.product_id, CONSUMABLE_PRODUCT_ID));
  await db.delete(category).where(eq(category.category_name, "Lending Id Category"));
  await db.delete(students).where(eq(students.department_id, DEPT_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

describe("PUT /api/lending/[id]", () => {
  it("updates order-level fields (due_date/status) without a mentor concept", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const order = await makeOrderWithItem(5);

    const res = await PUT(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, { method: "PUT", body: JSON.stringify({ due_date: "2030-01-01" }) }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );
    expect(res.status).toBe(200);

    const [updated] = await db.select({ due_date: lending_order.due_date }).from(lending_order).where(eq(lending_order.lending_order_id, order.lending_order_id));
    expect(updated.due_date).toBe("2030-01-01");
  });

  it("fully returning an item sets status RETURNED and restores stock", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const order = await makeOrderWithItem(5);

    const res = await PUT(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, {
        method: "PUT",
        body: JSON.stringify({ product_id: PRODUCT_ID, quantity: 0 }),
      }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );
    expect(res.status).toBe(200);

    const [updatedOrder] = await db.select({ status: lending_order.status }).from(lending_order).where(eq(lending_order.lending_order_id, order.lending_order_id));
    expect(updatedOrder.status).toBe("RETURNED");

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(15); // 10 + 5 returned
  });

  it("partially returning an item sets status PARTIALLY_RETURNED", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const order = await makeOrderWithItem(5);

    await PUT(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, { method: "PUT", body: JSON.stringify({ product_id: PRODUCT_ID, quantity: 2 }) }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );

    const [updatedOrder] = await db.select({ status: lending_order.status }).from(lending_order).where(eq(lending_order.lending_order_id, order.lending_order_id));
    expect(updatedOrder.status).toBe("PARTIALLY_RETURNED");
  });

  it("rejects marking a consumable item as returned", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const order = await makeOrderWithItem(5, "CONSUMABLE", CONSUMABLE_PRODUCT_ID);

    const res = await PUT(
      new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, { method: "PUT", body: JSON.stringify({ product_id: CONSUMABLE_PRODUCT_ID, quantity: 0 }) }),
      { params: Promise.resolve({ id: order.lending_order_id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/lending/[id]", () => {
  it("returns 404 for an order owned by someone else", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await DELETE(new NextRequest("http://localhost/api/lending/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes the order+items and restores stock", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const order = await makeOrderWithItem(4);

    const res = await DELETE(new NextRequest(`http://localhost/api/lending/${order.lending_order_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: order.lending_order_id }),
    });
    expect(res.status).toBe(200);

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(14); // 10 + 4 restored

    const remainingItems = await db.select().from(lending_item).where(eq(lending_item.lend_order_id, order.lending_order_id));
    expect(remainingItems).toHaveLength(0);
  });
});
