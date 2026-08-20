import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { PUT, DELETE } from "./route";

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
    role: "super_admin",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(departments).where(like(departments.department_name, "QaDeptItem%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("PUT /api/departments/[id]", () => {
  it("returns 403 for a non-super_admin user", async () => {
    actingAs(authedUser({ role: "user" }));
    const res = await PUT(
      new NextRequest("http://localhost/api/departments/x", { method: "PUT", body: JSON.stringify({ department_name: "y" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(403);
  });

  it("renames an existing department", async () => {
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptItem Before" }).returning();
    actingAs(authedUser());

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
    actingAs(authedUser());
    const res = await PUT(
      new NextRequest("http://localhost/api/departments/x", { method: "PUT", body: JSON.stringify({ department_name: "y" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });

  it("sets a code when provided, and leaves it alone when the field is omitted", async () => {
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptItem Coded" }).returning();
    actingAs(authedUser());

    const withCode = await PUT(
      new NextRequest(`http://localhost/api/departments/${dept.department_id}`, {
        method: "PUT",
        body: JSON.stringify({ department_name: "QaDeptItem Coded", code: "zz" }),
      }),
      { params: Promise.resolve({ id: dept.department_id }) },
    );
    expect(withCode.status).toBe(200);
    expect(((await withCode.json()) as { code: string }).code).toBe("ZZ");

    const nameOnly = await PUT(
      new NextRequest(`http://localhost/api/departments/${dept.department_id}`, {
        method: "PUT",
        body: JSON.stringify({ department_name: "QaDeptItem Coded Renamed" }),
      }),
      { params: Promise.resolve({ id: dept.department_id }) },
    );
    expect(nameOnly.status).toBe(200);
    expect(((await nameOnly.json()) as { code: string }).code).toBe("ZZ");
  });
});

describe("DELETE /api/departments/[id]", () => {
  it("deletes an existing department", async () => {
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptItem ToDelete" }).returning();
    actingAs(authedUser());

    const res = await DELETE(new NextRequest(`http://localhost/api/departments/${dept.department_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: dept.department_id }),
    });
    expect(res.status).toBe(200);
  });
});
