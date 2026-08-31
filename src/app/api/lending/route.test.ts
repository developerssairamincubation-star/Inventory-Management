import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, departments, products, category, stocks, students, lending_order, lending_item, coe_domains } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { GET, POST } from "./route";

// Returnable items require a due date (POST /api/lending refines on it): an
// item somebody has to bring back without a date can never go overdue, so
// nothing ever prompts anyone to chase it. Every RETURNABLE payload below
// therefore carries one, so each test still fails for the reason it was
// written to check rather than for a missing date.
const DUE_DATE = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);


const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}
let OWNER_ID: string;
let DEPT_ID: string;
let DOMAIN_ID: string;
let PRODUCT_ID: string;
let CONSUMABLE_PRODUCT_ID: string;

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: OWNER_ID,
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    domain_id: DOMAIN_ID,
    ...overrides,
  };
}

beforeAll(async () => {
  // The COE domain is the tenancy boundary, so the fixture has to model a
  // real deployment: the domain exists, the owner belongs to it, and the
  // products belong to the owner. Products used to be created with a null
  // user_id, which no longer resolves to any domain and is now correctly
  // invisible to everyone.
  const [domain] = await db.insert(coe_domains).values({ domain_name: "Lending Route Domain", room_name: "Lending Route Room" }).returning();
  DOMAIN_ID = domain.domain_id;
  const [owner] = await db.insert(users).values({ email: `lending-route-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Lending Owner", domain_id: DOMAIN_ID }).returning();
  OWNER_ID = owner.user_id;
  const [dept] = await db.insert(departments).values({ department_name: "Lending Route Dept", code: "LR" }).returning();
  DEPT_ID = dept.department_id;
  const [cat] = await db.insert(category).values({ category_name: "Lending Route Category" }).returning();
  const [product] = await db.insert(products).values({ product_name: "Lending Route Product", unit_cost: "1", category_id: cat.category_id, user_id: OWNER_ID }).returning();
  PRODUCT_ID = product.product_id;
  await db.insert(stocks).values({ product_id: PRODUCT_ID, quantity: 20 });
  const [consumableProduct] = await db.insert(products).values({ product_name: "Lending Route Consumable", unit_cost: "1", category_id: cat.category_id, user_id: OWNER_ID }).returning();
  CONSUMABLE_PRODUCT_ID = consumableProduct.product_id;
  await db.insert(stocks).values({ product_id: CONSUMABLE_PRODUCT_ID, quantity: 50 });
});

afterAll(async () => {
  const orders = await db.select({ id: lending_order.lending_order_id }).from(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) await db.delete(lending_item).where(inArray(lending_item.lend_order_id, orderIds));
  await db.delete(lending_order).where(eq(lending_order.issued_by_user_id, OWNER_ID));
  await db.delete(stocks).where(inArray(stocks.product_id, [PRODUCT_ID, CONSUMABLE_PRODUCT_ID]));
  await db.delete(products).where(inArray(products.product_id, [PRODUCT_ID, CONSUMABLE_PRODUCT_ID]));
  await db.delete(category).where(eq(category.category_name, "Lending Route Category"));
  await db.delete(students).where(eq(students.department_id, DEPT_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
  await db.delete(coe_domains).where(eq(coe_domains.domain_id, DOMAIN_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/lending", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await GET(new NextRequest("http://localhost/api/lending"));
    expect(res.status).toBe(401);
  });

  it("shows a COE's lending to everyone in that COE, hides it from other COEs, and shows everything to a super_admin", async () => {
    const [otherUser] = await db
      .insert(users)
      .values({ email: `lending-route-other-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Other Issuer" })
      .returning();

    actingAs(authedUser({ user_id: otherUser.user_id }));
    const postRes = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr999",
          student_name: "Admin Visibility Student",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
        }),
      }),
    );
    expect(postRes.status).toBe(201);
    const { order } = (await postRes.json()) as { order: { lending_order_id: string } };

    try {
      actingAs(authedUser({ role: "super_admin" }));
      const adminRes = await GET(new NextRequest("http://localhost/api/lending?period=yearly"));
      expect(adminRes.status).toBe(200);
      const adminBody = (await adminRes.json()) as { records: Array<{ id: string }> };
      expect(adminBody.records.some((r) => r.id === order.lending_order_id)).toBe(true);

      // A colleague in the same COE sees it too. The COE is the tenancy
      // boundary, so two people staffing the same room share its records —
      // this assertion used to require the opposite, back when scoping was
      // per-user and a colleague couldn't cover for you.
      actingAs(authedUser());
      const colleagueRes = await GET(new NextRequest("http://localhost/api/lending?period=yearly"));
      const colleagueBody = (await colleagueRes.json()) as { records: Array<{ id: string }> };
      expect(colleagueBody.records.some((r) => r.id === order.lending_order_id)).toBe(true);

      // Someone in a different COE does not.
      const [otherDomain] = await db
        .insert(coe_domains)
        .values({ domain_name: `Lending Other Domain ${Date.now()}`, room_name: `Lending Other Room ${Date.now()}` })
        .returning();
      try {
        actingAs(authedUser({ domain_id: otherDomain.domain_id }));
        const outsiderRes = await GET(new NextRequest("http://localhost/api/lending?period=yearly"));
        const outsiderBody = (await outsiderRes.json()) as { records: Array<{ id: string }> };
        expect(outsiderBody.records.some((r) => r.id === order.lending_order_id)).toBe(false);
      } finally {
        await db.delete(coe_domains).where(eq(coe_domains.domain_id, otherDomain.domain_id));
      }
    } finally {
      await db.delete(lending_item).where(eq(lending_item.lend_order_id, order.lending_order_id));
      await db.delete(lending_order).where(eq(lending_order.lending_order_id, order.lending_order_id));
      await db.delete(students).where(eq(students.student_id_code, "sit24lr999"));
      await db.delete(users).where(eq(users.user_id, otherUser.user_id));
      // The POST above decremented PRODUCT_ID's shared stock by 1 (real side
      // effect, same as any other lending) — restore it so sibling tests in
      // this file that assert on PRODUCT_ID's exact quantity aren't affected
      // by this test's fixture data regardless of run order.
      await db.update(stocks).set({ quantity: sql`${stocks.quantity} + 1` }).where(eq(stocks.product_id, PRODUCT_ID));
    }
  });
});

describe("POST /api/lending", () => {
  it("decodes the student ID, creates a new student, order, items, and decrements stock atomically", async () => {
    actingAs(authedUser());

    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr001",
          student_name: "Lending Route New Student",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 3, item_type: "RETURNABLE" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { order: { lending_order_id: string; status: string; domain_id: string }; items: Array<{ quantity: number }> };
    expect(body.items[0].quantity).toBe(3);
    expect(body.order.status).toBe("PENDING");
    expect(body.order.domain_id).toBe(DOMAIN_ID);

    const [stock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, PRODUCT_ID));
    expect(stock.quantity).toBe(17);

    const [student] = await db.select().from(students).where(eq(students.student_id_code, "sit24lr001"));
    expect(student).toBeDefined();
    expect(student.name).toBe("Lending Route New Student");
    expect(student.department_id).toBe(DEPT_ID);
  });

  it("reuses an existing borrower by student_id_code, only filling the name if it was blank", async () => {
    actingAs(authedUser());
    const [existing] = await db.insert(students).values({ student_id_code: "sit24lr002", name: "Original Name", department_id: DEPT_ID }).returning();

    await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr002",
          student_name: "Attempted Overwrite Name",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
        }),
      }),
    );

    const matches = await db.select().from(students).where(eq(students.student_id_code, "sit24lr002"));
    expect(matches).toHaveLength(1);
    expect(matches[0].student_id).toBe(existing.student_id);
    expect(matches[0].name).toBe("Original Name");
  });

  it("fills a blank name on re-scan", async () => {
    actingAs(authedUser());
    await db.insert(students).values({ student_id_code: "sit24lr003", name: null, department_id: DEPT_ID });

    await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr003",
          student_name: "Filled In Name",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
        }),
      }),
    );

    const [row] = await db.select().from(students).where(eq(students.student_id_code, "sit24lr003"));
    expect(row.name).toBe("Filled In Name");
  });

  it("returns 400 for a malformed student ID", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({ due_date: DUE_DATE, student_id_code: "not-an-id", lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 422 for a well-formed ID with an unknown department code", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({ due_date: DUE_DATE, student_id_code: "sit24zz001", lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }] }),
      }),
    );
    expect(res.status).toBe(422);
  });

  // The due date is what makes a returnable item chaseable: without one it
  // never goes overdue, never appears on the overdue list, and nobody is ever
  // prompted to get it back. Returnables were being stored with a null due
  // date, so these pin the rule down from both directions.
  it("rejects a returnable item with no due date", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr101",
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/due date/i);
  });

  it("rejects a due date on an all-consumable order", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr102",
          due_date: DUE_DATE,
          lending_items: [{ product_id: CONSUMABLE_PRODUCT_ID, quantity: 1, item_type: "CONSUMABLE" }],
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("stores the due date on a returnable order", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr103",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as { order: { lending_order_id: string; due_date: string | null } };
    expect(order.due_date).not.toBeNull();
  });

  it("marks the order CONSUMABLE only when every item is consumable", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr005",
          lending_items: [{ product_id: CONSUMABLE_PRODUCT_ID, quantity: 2, item_type: "CONSUMABLE" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { order: { status: string } };
    expect(body.order.status).toBe("CONSUMABLE");
  });

  it("lets a super_admin name the domain to issue on behalf of, but never a regular user", async () => {
    // A regular user with no COE of their own is an unconfigured account, not
    // a wildcard. It used to be able to attribute its lending to any domain
    // it named, which is exactly the privilege gap this closes — an admin has
    // to assign it a domain first.
    actingAs(authedUser({ domain_id: null }));

    const missing = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({ due_date: DUE_DATE, student_id_code: "sit24lr006", lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }] }),
      }),
    );
    expect(missing.status).toBe(400);

    const spoofed = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr006",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
          domain_id: DOMAIN_ID,
        }),
      }),
    );
    expect(spoofed.status).toBe(400);

    // A super_admin legitimately issues on behalf of a COE.
    actingAs(authedUser({ role: "super_admin", domain_id: null }));
    const withDomain = await POST(
      new NextRequest("http://localhost/api/lending", {
        method: "POST",
        body: JSON.stringify({
          student_id_code: "sit24lr006",
          due_date: DUE_DATE,
          lending_items: [{ product_id: PRODUCT_ID, quantity: 1, item_type: "RETURNABLE" }],
          domain_id: DOMAIN_ID,
        }),
      }),
    );
    expect(withDomain.status).toBe(201);
  });
});
