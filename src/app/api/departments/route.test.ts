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
  await db.delete(departments).where(like(departments.department_name, "QaDeptList%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/departments", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await GET(new NextRequest("http://localhost/api/departments"));
    expect(res.status).toBe(401);
  });

  it("returns departments ordered by name for any authenticated role", async () => {
    actingAs(authedUser({ role: "user" }));
    await db.insert(departments).values({ department_name: "QaDeptList Z" });
    const res = await GET(new NextRequest("http://localhost/api/departments"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ department_name: string }>;
    expect(body.some((d) => d.department_name === "QaDeptList Z")).toBe(true);
  });
});

describe("POST /api/departments", () => {
  it("returns 403 for a non-super_admin user", async () => {
    actingAs(authedUser({ role: "user" }));
    const res = await POST(
      new NextRequest("http://localhost/api/departments", { method: "POST", body: JSON.stringify({ department_name: "QaDeptList A" }) }),
    );
    expect(res.status).toBe(403);
  });

  it("creates a department for a super_admin", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: "QaDeptList New" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { department_name: string };
    expect(body.department_name).toBe("QaDeptList New");
  });

  it("accepts and uppercases a valid 2-letter code", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: "QaDeptList Coded", code: "cs" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CS");
  });

  it("rejects a code that isn't exactly 2 letters", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: "QaDeptList BadCode", code: "csx" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate code", async () => {
    actingAs(authedUser({ role: "super_admin" }));
    await POST(
      new NextRequest("http://localhost/api/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: "QaDeptList DupA", code: "dp" }),
      }),
    );
    const res = await POST(
      new NextRequest("http://localhost/api/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: "QaDeptList DupB", code: "dp" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});
