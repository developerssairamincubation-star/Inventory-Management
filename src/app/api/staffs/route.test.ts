import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { staffs, departments } from "@/db/schema";

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
  await db.delete(staffs).where(like(staffs.name, "QaStaffList%"));
  await db.delete(departments).where(like(departments.department_name, "QaDeptForStaffList%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/staffs", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/staffs"));
    expect(res.status).toBe(401);
  });

  it("returns staff with nested department name", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStaffList A" }).returning();
    await db.insert(staffs).values({ name: "QaStaffList Alice", department_id: dept.department_id, employee_id: "E001" });

    const res = await GET(new NextRequest("http://localhost/api/staffs"));
    const body = (await res.json()) as Array<{ name: string; departments: { department_name: string } | null }>;
    const alice = body.find((s) => s.name === "QaStaffList Alice");
    expect(alice?.departments).toEqual({ department_name: "QaDeptForStaffList A" });
  });
});

describe("POST /api/staffs", () => {
  it("returns 409 on duplicate employee_id", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStaffList Dup" }).returning();
    await db.insert(staffs).values({ name: "QaStaffList Carl", department_id: dept.department_id, employee_id: "E123" });

    const res = await POST(
      new NextRequest("http://localhost/api/staffs", {
        method: "POST",
        body: JSON.stringify({ name: "QaStaffList Dan", department_id: dept.department_id, employee_id: "E123" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("creates a staff member", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStaffList New" }).returning();

    const res = await POST(
      new NextRequest("http://localhost/api/staffs", {
        method: "POST",
        body: JSON.stringify({ name: "QaStaffList New", department_id: dept.department_id }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
