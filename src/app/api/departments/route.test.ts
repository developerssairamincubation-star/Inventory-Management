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
import { GET, POST } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    firebase_uid: "fb-1",
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(departments).where(like(departments.department_name, "QaDeptList%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/departments", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/departments"));
    expect(res.status).toBe(401);
  });

  it("returns departments ordered by name for any authenticated role", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "user" }));
    await db.insert(departments).values({ department_name: "QaDeptList Z" });
    const res = await GET(new NextRequest("http://localhost/api/departments"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ department_name: string }>;
    expect(body.some((d) => d.department_name === "QaDeptList Z")).toBe(true);
  });
});

describe("POST /api/departments", () => {
  it("returns 403 for a non-super_admin user", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "user" }));
    const res = await POST(
      new NextRequest("http://localhost/api/departments", { method: "POST", body: JSON.stringify({ department_name: "QaDeptList A" }) }),
    );
    expect(res.status).toBe(403);
  });

  it("creates a department for a super_admin", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "super_admin" }));
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
});
