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
import { GET, POST } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(category).where(like(category.category_name, "Test Category%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/categories", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/categories"));
    expect(res.status).toBe(401);
  });

  it("returns categories ordered by name", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
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
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(
      new NextRequest("http://localhost/api/categories", { method: "POST", body: JSON.stringify({ category_name: "x" }) }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when category_name is missing", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/categories", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("creates a category", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
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
});
