import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/passwords";

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
    email: "admin@example.com",
    full_name: "Admin",
    role: "super_admin",
    is_active: true,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(users).where(like(users.email, "admin-users-route-%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/admin/users", () => {
  it("returns 403 for a non-super_admin", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "user" }));
    const res = await GET(new NextRequest("http://localhost/api/admin/users"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/users", () => {
  it("returns 400 for an invalid role", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/admin/users", { method: "POST", body: JSON.stringify({ email: "x@x.com", full_name: "X", password: "p", role: "bogus" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a user with a real bcrypt password_hash (no Firebase account)", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const email = `admin-users-route-new-${Date.now()}@example.com`;

    const res = await POST(
      new NextRequest("http://localhost/api/admin/users", { method: "POST", body: JSON.stringify({ email, full_name: "New User", password: "ChangeMe123!" }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user_id: string; email: string; role: string };
    expect(body.email).toBe(email);
    expect(body.role).toBe("user");

    const [row] = await db.select().from(users).where(like(users.email, email));
    expect(row.password_hash).not.toBe("ChangeMe123!");
    await expect(verifyPassword("ChangeMe123!", row.password_hash)).resolves.toBe(true);
  });
});
