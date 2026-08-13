import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { PUT, DELETE } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    full_name: "Test User",
    role: "super_admin",
    is_active: true,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(departments).where(like(departments.department_name, "QaDeptItem%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("PUT /api/departments/[id]", () => {
  it("returns 403 for a non-super_admin user", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "user" }));
    const res = await PUT(
      new NextRequest("http://localhost/api/departments/x", { method: "PUT", body: JSON.stringify({ department_name: "y" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(403);
  });

  it("renames an existing department", async () => {
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptItem Before" }).returning();
    mockGetAuthUser.mockResolvedValue(authedUser());

    const res = await PUT(
      new NextRequest(`http://localhost/api/departments/${dept.department_id}`, {
        method: "PUT",
        body: JSON.stringify({ department_name: "QaDeptItem After" }),
      }),
      { params: Promise.resolve({ id: dept.department_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { department_name: string };
    expect(body.department_name).toBe("QaDeptItem After");
  });

  it("returns 404 for a nonexistent department", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await PUT(
      new NextRequest("http://localhost/api/departments/x", { method: "PUT", body: JSON.stringify({ department_name: "y" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/departments/[id]", () => {
  it("deletes an existing department", async () => {
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptItem ToDelete" }).returning();
    mockGetAuthUser.mockResolvedValue(authedUser());

    const res = await DELETE(new NextRequest(`http://localhost/api/departments/${dept.department_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: dept.department_id }),
    });
    expect(res.status).toBe(200);
  });
});
