import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET, PUT } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "admin@example.com",
    full_name: "Admin",
    role: "super_admin",
    is_active: true,
    ...overrides,
  };
}

async function makeUser(email: string, role: "super_admin" | "user" = "user") {
  const [row] = await db.insert(users).values({ email, password_hash: "irrelevant", full_name: "Target User", role }).returning();
  return row;
}

afterAll(async () => {
  await db.delete(users).where(like(users.email, "admin-users-id-%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/admin/users/[id]", () => {
  it("returns 404 for an unknown id", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/admin/users/x"), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/admin/users/[id]", () => {
  it("partially updates full_name/is_active", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const target = await makeUser(`admin-users-id-${Date.now()}@example.com`);

    const res = await PUT(
      new NextRequest(`http://localhost/api/admin/users/${target.user_id}`, { method: "PUT", body: JSON.stringify({ full_name: "Renamed", is_active: false }) }),
      { params: Promise.resolve({ id: target.user_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { full_name: string; is_active: boolean };
    expect(body.full_name).toBe("Renamed");
    expect(body.is_active).toBe(false);
  });

  it("refuses to demote the only super_admin", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const onlyAdmin = await makeUser(`admin-users-id-onlyadmin-${Date.now()}@example.com`, "super_admin");

    // The endpoint's "only super admin" check counts ALL super_admin rows
    // globally (matches the original app's behavior) — temporarily demote
    // any other existing super admins (e.g. the dev seed user) so this
    // test's target is genuinely the only one, then restore them exactly.
    const others = await db.select({ user_id: users.user_id }).from(users).where(eq(users.role, "super_admin"));
    const otherIds = others.map((o) => o.user_id).filter((id) => id !== onlyAdmin.user_id);
    if (otherIds.length) {
      for (const id of otherIds) await db.update(users).set({ role: "user" }).where(eq(users.user_id, id));
    }

    try {
      const res = await PUT(
        new NextRequest(`http://localhost/api/admin/users/${onlyAdmin.user_id}`, { method: "PUT", body: JSON.stringify({ role: "user" }) }),
        { params: Promise.resolve({ id: onlyAdmin.user_id }) },
      );
      expect(res.status).toBe(400);
    } finally {
      for (const id of otherIds) await db.update(users).set({ role: "super_admin" }).where(eq(users.user_id, id));
    }
  });
});
