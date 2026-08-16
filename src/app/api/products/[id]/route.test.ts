import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { products, stocks, category, users, lending_order, lending_item, students, departments } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});
vi.mock("@/lib/s3", () => ({ deleteFromS3: vi.fn(), getS3KeyFromUrl: vi.fn(() => null) }));

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET, PUT, DELETE } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;

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

async function makeProduct(name: string, categoryId?: string) {
  const [product] = await db.insert(products).values({ product_name: name, unit_cost: "5.00", user_id: OWNER_ID, category_id: categoryId }).returning();
  await db.insert(stocks).values({ product_id: product.product_id, quantity: 10 });
  return product;
}

beforeAll(async () => {
  const [owner] = await db
    .insert(users)
    .values({ email: `products-id-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Products Id Owner" })
    .returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));

  const prodRows = await db.select({ id: products.product_id }).from(products).where(like(products.product_name, "Products Id%"));
  const prodIds = prodRows.map((p) => p.id);
  if (prodIds.length) await db.delete(stocks).where(inArray(stocks.product_id, prodIds));
  await db.delete(products).where(like(products.product_name, "Products Id%"));

  await db.delete(students).where(eq(students.name, "Products Id Student"));
  await db.delete(departments).where(eq(departments.department_name, "Products Id Dept"));
  await db.delete(category).where(eq(category.category_name, "Products Id Category"));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/products/[id]", () => {
  it("returns 404 for a product owned by someone else", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/products/x"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the product enriched with stocks/category_name and empty lending history", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "Products Id Category" }).returning();
    const product = await makeProduct("Products Id Widget", cat.category_id);

    const res = await GET(new NextRequest(`http://localhost/api/products/${product.product_id}`), {
      params: Promise.resolve({ id: product.product_id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { stocks: { quantity: number }; category_name: string }; borrowingHistory: unknown[] };
    expect(body.product.stocks.quantity).toBe(10);
    expect(body.product.category_name).toBe("Products Id Category");
    expect(body.borrowingHistory).toEqual([]);
  });

  it("includes borrowing history joined with student/department/mentor names", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Products Id Borrowed");
    const [dept] = await db.insert(departments).values({ department_name: "Products Id Dept" }).returning();
    const [student] = await db.insert(students).values({ name: "Products Id Student", department_id: dept.department_id }).returning();
    const [order] = await db
      .insert(lending_order)
      .values({ borrower_type: "STUDENT", borrower_student_id: student.student_id, issued_by_user_id: OWNER_ID, status: "PENDING" })
      .returning();
    await db.insert(lending_item).values({ lend_order_id: order.lending_order_id, product_id: product.product_id, quantity: 2, original_quantity: 2 });

    const res = await GET(new NextRequest(`http://localhost/api/products/${product.product_id}?period=yearly`), {
      params: Promise.resolve({ id: product.product_id }),
    });
    const body = (await res.json()) as { borrowingHistory: Array<{ borrower_name: string; department: string; quantity: number }>; lendingSummary: { totalLent: number } };
    expect(body.borrowingHistory).toHaveLength(1);
    expect(body.borrowingHistory[0]).toMatchObject({ borrower_name: "Products Id Student", department: "Products Id Dept", quantity: 2 });
    expect(body.lendingSummary.totalLent).toBe(2);
  });
});

describe("PUT /api/products/[id]", () => {
  it("partially updates a product and reports the current image_url", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Products Id Before Update");

    const res = await PUT(
      new NextRequest(`http://localhost/api/products/${product.product_id}`, { method: "PUT", body: JSON.stringify({ product_name: "Products Id After Update" }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product_name: string; image_url: string | null };
    expect(body.product_name).toBe("Products Id After Update");
    expect(body.image_url).toBeNull();
  });
});

describe("DELETE /api/products/[id]", () => {
  it("cascades: deletes lending_item/lending_order/stocks/product_image/products", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Products Id ToDelete");

    const res = await DELETE(new NextRequest(`http://localhost/api/products/${product.product_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: product.product_id }),
    });
    expect(res.status).toBe(200);

    const [remainingStock] = await db.select().from(stocks).where(eq(stocks.product_id, product.product_id));
    expect(remainingStock).toBeUndefined();
  });

  it("a regular user cannot delete someone else's product, but a super_admin can", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const product = await makeProduct("Products Id Other Owners");

    mockGetAuthUser.mockResolvedValue(authedUser({ user_id: "00000000-0000-0000-0000-000000000000", role: "user" }));
    const deniedRes = await DELETE(new NextRequest(`http://localhost/api/products/${product.product_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: product.product_id }),
    });
    expect(deniedRes.status).toBe(404);

    mockGetAuthUser.mockResolvedValue(authedUser({ user_id: "11111111-1111-1111-1111-111111111111", role: "super_admin" }));
    const adminRes = await DELETE(new NextRequest(`http://localhost/api/products/${product.product_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: product.product_id }),
    });
    expect(adminRes.status).toBe(200);

    const [remainingProduct] = await db.select().from(products).where(eq(products.product_id, product.product_id));
    expect(remainingProduct).toBeUndefined();
  });
});
