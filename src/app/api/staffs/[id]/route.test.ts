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
import { PUT } from "./route";

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
  await db.delete(staffs).where(like(staffs.name, "QaStaffItem%"));
  await db.delete(departments).where(like(departments.department_name, "QaDeptForStaffItem%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("PUT /api/staffs/[id]", () => {
  it("returns 404 for an unknown id", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await PUT(new NextRequest("http://localhost/api/staffs/x", { method: "PUT", body: JSON.stringify({ name: "y" }) }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("partially updates a staff member", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStaffItem A" }).returning();
    const [staff] = await db.insert(staffs).values({ name: "QaStaffItem Before", department_id: dept.department_id }).returning();

    const res = await PUT(
      new NextRequest(`http://localhost/api/staffs/${staff.staff_id}`, { method: "PUT", body: JSON.stringify({ email: "s@x.com" }) }),
      { params: Promise.resolve({ id: staff.staff_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("s@x.com");
  });
});
