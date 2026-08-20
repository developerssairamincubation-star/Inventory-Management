import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { products, stocks, users, coe_domains, stock_transfers } from "@/db/schema";

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

let SOURCE_USER_ID: string;
let SOURCE_DOMAIN_ID: string;
let DEST_USER_ID: string;
let DEST_DOMAIN_ID: string;
let EMPTY_DOMAIN_ID: string;
let ADMIN_USER_ID: string;

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: SOURCE_USER_ID,
    email: "transfer-user@example.com",
    full_name: "Transfer Source User",
    role: "user",
    is_active: true,
    domain_id: SOURCE_DOMAIN_ID,
    ...overrides,
  };
}

async function makeProduct(name: string, quantity = 10) {
  const [product] = await db.insert(products).values({ product_name: name, unit_cost: "5.00", user_id: SOURCE_USER_ID }).returning();
  await db.insert(stocks).values({ product_id: product.product_id, quantity });
  return product;
}

beforeAll(async () => {
  const stamp = Date.now();
  const [sourceDomain] = await db.insert(coe_domains).values({ domain_name: `Transfer Source Domain ${stamp}`, room_name: `Transfer Source Room ${stamp}` }).returning();
  SOURCE_DOMAIN_ID = sourceDomain.domain_id;
  const [destDomain] = await db.insert(coe_domains).values({ domain_name: `Transfer Dest Domain ${stamp}`, room_name: `Transfer Dest Room ${stamp}` }).returning();
  DEST_DOMAIN_ID = destDomain.domain_id;
  const [emptyDomain] = await db.insert(coe_domains).values({ domain_name: `Transfer Empty Domain ${stamp}`, room_name: `Transfer Empty Room ${stamp}` }).returning();
  EMPTY_DOMAIN_ID = emptyDomain.domain_id;

  const [sourceUser] = await db.insert(users).values({ email: `transfer-source-${stamp}@example.com`, password_hash: "irrelevant", full_name: "Transfer Source User", domain_id: SOURCE_DOMAIN_ID }).returning();
  SOURCE_USER_ID = sourceUser.user_id;
  const [destUser] = await db.insert(users).values({ email: `transfer-dest-${stamp}@example.com`, password_hash: "irrelevant", full_name: "Transfer Dest User", domain_id: DEST_DOMAIN_ID }).returning();
  DEST_USER_ID = destUser.user_id;
  const [adminUser] = await db.insert(users).values({ email: `transfer-admin-${stamp}@example.com`, password_hash: "irrelevant", full_name: "Transfer Admin", role: "super_admin" }).returning();
  ADMIN_USER_ID = adminUser.user_id;
});

afterAll(async () => {
  // Partial transfers create a new product row that copies the source's
  // name, so this one LIKE pattern catches both sides of every transfer.
  const prodRows = await db.select({ id: products.product_id }).from(products).where(like(products.product_name, "Transfer Route%"));
  const prodIds = prodRows.map((p) => p.id);
  if (prodIds.length) {
    await db.delete(stock_transfers).where(inArray(stock_transfers.source_product_id, prodIds));
    await db.delete(stock_transfers).where(inArray(stock_transfers.destination_product_id, prodIds));
    await db.delete(stocks).where(inArray(stocks.product_id, prodIds));
  }
  await db.delete(products).where(like(products.product_name, "Transfer Route%"));
  await db.delete(users).where(inArray(users.user_id, [SOURCE_USER_ID, DEST_USER_ID, ADMIN_USER_ID]));
  await db.delete(coe_domains).where(inArray(coe_domains.domain_id, [SOURCE_DOMAIN_ID, DEST_DOMAIN_ID, EMPTY_DOMAIN_ID]));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("POST /api/products/[id]/transfer", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await POST(
      new NextRequest("http://localhost/api/products/x/transfer", { method: "POST", body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(401);
  });

  it("full transfer (quantity == all available stock) reassigns the product to the destination domain's user", async () => {
    actingAs(authedUser());
    const product = await makeProduct("Transfer Route Full", 8);

    const res = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: DEST_DOMAIN_ID, quantity: 8 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; destination_product_id: string };
    expect(body.mode).toBe("full");
    expect(body.destination_product_id).toBe(product.product_id);

    const [updatedProduct] = await db.select({ user_id: products.user_id }).from(products).where(eq(products.product_id, product.product_id));
    expect(updatedProduct.user_id).toBe(DEST_USER_ID);

    const [stockRow] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, product.product_id));
    expect(stockRow.quantity).toBe(8);

    const transferRows = await db.select().from(stock_transfers).where(eq(stock_transfers.source_product_id, product.product_id));
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0].mode).toBe("full");
    expect(transferRows[0].quantity).toBe(8);
    expect(transferRows[0].destination_domain_id).toBe(DEST_DOMAIN_ID);
  });

  it("partial transfer creates a new product for the destination domain and decrements the source", async () => {
    actingAs(authedUser());
    const product = await makeProduct("Transfer Route Partial", 10);

    const res = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: DEST_DOMAIN_ID, quantity: 3, location: "R9" }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; destination_product_id: string };
    expect(body.mode).toBe("partial");
    expect(body.destination_product_id).not.toBe(product.product_id);

    const [sourceStock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, product.product_id));
    expect(sourceStock.quantity).toBe(7);

    const [destProduct] = await db.select().from(products).where(eq(products.product_id, body.destination_product_id));
    expect(destProduct.user_id).toBe(DEST_USER_ID);
    expect(destProduct.product_name).toBe("Transfer Route Partial");
    expect(destProduct.sku_code).toBeTruthy();
    expect(destProduct.sku_code).not.toBe(product.sku_code);

    const [destStock] = await db.select({ quantity: stocks.quantity, location: stocks.location }).from(stocks).where(eq(stocks.product_id, body.destination_product_id));
    expect(destStock.quantity).toBe(3);
    expect(destStock.location).toBe("R9");

    const transferRows = await db.select().from(stock_transfers).where(eq(stock_transfers.destination_product_id, body.destination_product_id));
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0].mode).toBe("partial");
  });

  it("rejects transferring more than the available quantity", async () => {
    actingAs(authedUser());
    const product = await makeProduct("Transfer Route OverQty", 5);

    const res = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: DEST_DOMAIN_ID, quantity: 6 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects transferring to the product's own current domain", async () => {
    actingAs(authedUser());
    const product = await makeProduct("Transfer Route SameDomain", 5);

    const res = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: SOURCE_DOMAIN_ID, quantity: 1 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a target domain with no active assigned user", async () => {
    actingAs(authedUser());
    const product = await makeProduct("Transfer Route NoUser", 5);

    const res = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: EMPTY_DOMAIN_ID, quantity: 1 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(res.status).toBe(400);
  });

  it("scopes transfers to the COE: a colleague may, an outsider may not, a super_admin always may", async () => {
    const product = await makeProduct("Transfer Route OtherOwner", 5);

    // Someone in a *different* COE cannot see the product at all. This used
    // to be asserted of any other user, back when scoping was per-creator;
    // the boundary is the COE now, so the outsider is the real negative case.
    actingAs(authedUser({ user_id: "00000000-0000-0000-0000-000000000000", role: "user", domain_id: EMPTY_DOMAIN_ID }));
    const deniedRes = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: DEST_DOMAIN_ID, quantity: 1 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(deniedRes.status).toBe(404);

    // A colleague in the same COE can — they staff the same room.
    actingAs(authedUser({ user_id: "00000000-0000-0000-0000-000000000000", role: "user", domain_id: SOURCE_DOMAIN_ID }));
    const colleagueRes = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: DEST_DOMAIN_ID, quantity: 1 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(colleagueRes.status).toBe(200);

    actingAs(authedUser({ user_id: ADMIN_USER_ID, role: "super_admin", domain_id: null }));
    const adminRes = await POST(
      new NextRequest(`http://localhost/api/products/${product.product_id}/transfer`, { method: "POST", body: JSON.stringify({ target_domain_id: DEST_DOMAIN_ID, quantity: 1 }) }),
      { params: Promise.resolve({ id: product.product_id }) },
    );
    expect(adminRes.status).toBe(200);
  });
});
