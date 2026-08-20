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
import { PUT } from "./route";

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
  await db.delete(category).where(like(category.category_name, "QaCategoryItem%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("PUT /api/categories/[id]", () => {
  // Categories are global reference data whose `code` seeds SKU generation
  // for every product in them, so writes are super_admin-only — matching
  // departments and coe_domains. Any signed-in user could previously rename
  // or re-code any category.
  it("backfills a code on a category that predates the feature", async () => {
    const [cat] = await db.insert(category).values({ category_name: "QaCategoryItem Backfill" }).returning();
    actingAs(authedUser({ role: "super_admin" }));

    const res = await PUT(
      new NextRequest(`http://localhost/api/categories/${cat.category_id}`, {
        method: "PUT",
        body: JSON.stringify({ code: "bf" }),
      }),
      { params: Promise.resolve({ id: cat.category_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BF");
  });

  it("rejects an invalid code", async () => {
    const [cat] = await db.insert(category).values({ category_name: "QaCategoryItem Invalid" }).returning();
    actingAs(authedUser({ role: "super_admin" }));

    const res = await PUT(
      new NextRequest(`http://localhost/api/categories/${cat.category_id}`, {
        method: "PUT",
        body: JSON.stringify({ code: "toolong" }),
      }),
      { params: Promise.resolve({ id: cat.category_id }) },
    );
    expect(res.status).toBe(400);
  });
});
