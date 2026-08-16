import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { category } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { PUT } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

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
  mockGetAuthUser.mockReset();
});

describe("PUT /api/categories/[id]", () => {
  it("backfills a code on a category that predates the feature", async () => {
    const [cat] = await db.insert(category).values({ category_name: "QaCategoryItem Backfill" }).returning();
    mockGetAuthUser.mockResolvedValue(authedUser());

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
    mockGetAuthUser.mockResolvedValue(authedUser());

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
