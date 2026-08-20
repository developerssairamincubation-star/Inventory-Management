import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { category } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { GET, POST } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(category).where(like(category.category_name, "Test Category%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/categories", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await GET(new NextRequest("http://localhost/api/categories"));
    expect(res.status).toBe(401);
  });

  it("returns categories ordered by name", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    await db.insert(category).values({ category_name: "Test Category Z" });
    await db.insert(category).values({ category_name: "Test Category A" });

    const res = await GET(new NextRequest("http://localhost/api/categories"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ category_name: string }>;
    const names = body.filter((c) => c.category_name.startsWith("Test Category")).map((c) => c.category_name);
    expect(names).toEqual(["Test Category A", "Test Category Z"]);
  });
});

describe("POST /api/categories", () => {
  // Categories are global reference data whose `code` seeds SKU generation
  // for every product in them, so writes are super_admin-only — matching
  // departments and coe_domains. Any signed-in user could previously rename
  // or re-code any category.
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await POST(
      new NextRequest("http://localhost/api/categories", { method: "POST", body: JSON.stringify({ category_name: "x" }) }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when category_name is missing", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(new NextRequest("http://localhost/api/categories", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("creates a category", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name: "Test Category New" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { category_name: string };
    expect(body.category_name).toBe("Test Category New");
  });

  it("auto-suggests a code from the category name when none is given", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name: "Test Category Arduino Boards" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string | null };
    expect(body.code).toMatch(/^[A-Z]{2,4}$/);
  });

  it("accepts and uppercases an explicit code", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name: "Test Category Resistors", code: "res" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RES");
  });

  it("rejects a duplicate explicit code", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    await POST(
      new NextRequest("http://localhost/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name: "Test Category Cap A", code: "cap" }),
      }),
    );
    const res = await POST(
      new NextRequest("http://localhost/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name: "Test Category Cap B", code: "cap" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("refuses a regular user", async () => {
    actingAs(authedUser({ role: "user" }));
    const res = await POST(
      new NextRequest("http://localhost/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name: "Should Not Exist" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
