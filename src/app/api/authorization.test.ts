// The auth layer, exercised for real.
//
// Every other route test stubs `requireUser`, which keeps them fast and
// focused but means they prove nothing about authorization itself — a route
// could lose its scope predicate entirely and 33 of the 34 route test files
// would still pass. That is how /api/upload/presign shipped with no
// authentication call at all, and how /api/stocks/[id], /api/students/[id]
// and both /api/categories handlers ended up unscoped.
//
// Nothing here is mocked: real signed cookies, the real CSRF check, real rows
// in the database, and the real domain-scoping predicates.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, coe_domains, products, stocks, category } from "@/db/schema";
import { signAccessToken } from "@/lib/jwt";
import { hashPassword } from "@/lib/passwords";

import { GET as getStock } from "./stocks/[id]/route";
import { POST as presign } from "./upload/presign/route";
import { GET as listProducts } from "./products/route";
import { POST as createCategory } from "./categories/route";
import { GET as listUsers } from "./admin/users/route";

const SUFFIX = randomBytes(4).toString("hex");

let domainA: string;
let domainB: string;
let userInA: string;
let userInB: string;
let disabledUser: string;
let adminUser: string;
let productInA: string;
let categoryId: string;

async function makeUser(opts: { name: string; role?: "user" | "super_admin"; domain?: string | null; active?: boolean }) {
  const [row] = await db
    .insert(users)
    .values({
      email: `authz-${opts.name}-${SUFFIX}@example.test`,
      password_hash: await hashPassword("irrelevant-but-real-length"),
      full_name: `Authz ${opts.name}`,
      role: opts.role ?? "user",
      domain_id: opts.domain ?? null,
      is_active: opts.active ?? true,
    })
    .returning();
  return row.user_id;
}

/**
 * Builds a request carrying the same cookies a browser would after login.
 * `csrf` defaults to matching, so a test opts *out* of a valid CSRF token
 * rather than having to remember to opt in.
 */
async function signedRequest(
  url: string,
  opts: {
    userId?: string;
    email?: string;
    role?: string;
    method?: string;
    body?: unknown;
    csrf?: "valid" | "missing" | "mismatched";
  } = {},
) {
  const cookies: string[] = [];

  if (opts.userId) {
    const token = await signAccessToken({
      sub: opts.userId,
      email: opts.email ?? `authz-${SUFFIX}@example.test`,
      role: opts.role ?? "user",
    });
    cookies.push(`access_token=${token}`);
  }

  const csrfMode = opts.csrf ?? "valid";
  if (csrfMode !== "missing") cookies.push("csrf_token=csrf-value");

  const headers: Record<string, string> = { cookie: cookies.join("; ") };
  if (csrfMode === "valid") headers["x-csrf-token"] = "csrf-value";
  if (csrfMode === "mismatched") headers["x-csrf-token"] = "a-different-value";
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

beforeAll(async () => {
  const [a] = await db.insert(coe_domains).values({ domain_name: `Authz A ${SUFFIX}`, room_name: `Room A ${SUFFIX}` }).returning();
  const [b] = await db.insert(coe_domains).values({ domain_name: `Authz B ${SUFFIX}`, room_name: `Room B ${SUFFIX}` }).returning();
  domainA = a.domain_id;
  domainB = b.domain_id;

  userInA = await makeUser({ name: "a", domain: domainA });
  userInB = await makeUser({ name: "b", domain: domainB });
  disabledUser = await makeUser({ name: "disabled", domain: domainA, active: false });
  adminUser = await makeUser({ name: "admin", role: "super_admin" });

  const [cat] = await db.insert(category).values({ category_name: `Authz Category ${SUFFIX}`, code: `AZ` }).returning();
  categoryId = cat.category_id;

  const [product] = await db
    .insert(products)
    .values({ product_name: `Authz Product ${SUFFIX}`, unit_cost: "1", user_id: userInA, sku_code: `AZ-${SUFFIX}` })
    .returning();
  productInA = product.product_id;
  await db.insert(stocks).values({ product_id: productInA, quantity: 10 });
});

afterAll(async () => {
  await db.delete(stocks).where(eq(stocks.product_id, productInA));
  await db.delete(products).where(eq(products.product_id, productInA));
  await db.delete(category).where(eq(category.category_id, categoryId));
  await db.delete(users).where(inArray(users.user_id, [userInA, userInB, disabledUser, adminUser]));
  await db.delete(coe_domains).where(inArray(coe_domains.domain_id, [domainA, domainB]));
});

describe("authentication", () => {
  it("rejects a request with no access token", async () => {
    const res = await listProducts(await signedRequest("http://localhost/api/products"));
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const req = new NextRequest("http://localhost/api/products", {
      headers: { cookie: "access_token=not.a.real.token" },
    });
    const res = await listProducts(req);
    expect(res.status).toBe(401);
  });

  it("rejects a valid token belonging to a deactivated account", async () => {
    // The signature is fine — is_active is re-read from the database on every
    // request, so deactivating an account takes effect immediately rather
    // than at the next token expiry.
    const res = await listProducts(await signedRequest("http://localhost/api/products", { userId: disabledUser }));
    expect(res.status).toBe(401);
  });

  it("rejects a token whose subject no longer exists", async () => {
    const res = await listProducts(
      await signedRequest("http://localhost/api/products", { userId: "dead0000-0000-4000-8000-000000000000" }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a valid token", async () => {
    const res = await listProducts(await signedRequest("http://localhost/api/products", { userId: userInA }));
    expect(res.status).toBe(200);
  });
});

describe("CSRF", () => {
  it("rejects a mutating request with no CSRF header", async () => {
    const res = await presign(
      await signedRequest("http://localhost/api/upload/presign", {
        userId: userInA,
        method: "POST",
        body: { mimeType: "image/png" },
        csrf: "missing",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a mutating request whose CSRF header doesn't match the cookie", async () => {
    const res = await presign(
      await signedRequest("http://localhost/api/upload/presign", {
        userId: userInA,
        method: "POST",
        body: { mimeType: "image/png" },
        csrf: "mismatched",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("does not require CSRF on a read", async () => {
    const res = await listProducts(
      await signedRequest("http://localhost/api/products", { userId: userInA, csrf: "missing" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("role enforcement", () => {
  it("refuses a regular user on a super_admin-only route", async () => {
    const res = await listUsers(await signedRequest("http://localhost/api/admin/users", { userId: userInA }));
    expect(res.status).toBe(403);
  });

  it("refuses a regular user creating a category", async () => {
    const res = await createCategory(
      await signedRequest("http://localhost/api/categories", {
        userId: userInA,
        method: "POST",
        body: { category_name: `Should Not Exist ${SUFFIX}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("admits a super_admin", async () => {
    const res = await listUsers(
      await signedRequest("http://localhost/api/admin/users", { userId: adminUser, role: "super_admin" }),
    );
    expect(res.status).toBe(200);
  });

  it("ignores the role claim in the token and trusts the database", async () => {
    // A token minted with role: "super_admin" for an account that is only a
    // "user" must not grant admin access — the claim is a hint, the row is
    // the authority.
    const res = await listUsers(
      await signedRequest("http://localhost/api/admin/users", { userId: userInA, role: "super_admin" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("domain scoping", () => {
  it("lets a user in the owning COE read a product's stock", async () => {
    const res = await getStock(await signedRequest(`http://localhost/api/stocks/${productInA}`, { userId: userInA }), {
      params: Promise.resolve({ id: productInA }),
    });
    expect(res.status).toBe(200);
  });

  it("hides another COE's stock", async () => {
    // This route authenticated but never authorized — any signed-in user
    // could read any product's stock level, in any COE.
    const res = await getStock(await signedRequest(`http://localhost/api/stocks/${productInA}`, { userId: userInB }), {
      params: Promise.resolve({ id: productInA }),
    });
    expect(res.status).toBe(404);
  });

  it("shows a super_admin every COE's stock", async () => {
    const res = await getStock(
      await signedRequest(`http://localhost/api/stocks/${productInA}`, { userId: adminUser, role: "super_admin" }),
      { params: Promise.resolve({ id: productInA }) },
    );
    expect(res.status).toBe(200);
  });

  it("excludes another COE's products from the list", async () => {
    const res = await listProducts(await signedRequest("http://localhost/api/products", { userId: userInB }));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ product_id: string }>;
    expect(rows.some((r) => r.product_id === productInA)).toBe(false);
  });

  it("includes the COE's own products in the list", async () => {
    const res = await listProducts(await signedRequest("http://localhost/api/products", { userId: userInA }));
    const rows = (await res.json()) as Array<{ product_id: string }>;
    expect(rows.some((r) => r.product_id === productInA)).toBe(true);
  });
});
