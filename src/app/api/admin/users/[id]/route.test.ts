import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, coe_domains } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { GET, PUT } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "admin@example.com",
    full_name: "Admin",
    role: "super_admin",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

async function makeUser(email: string, role: "super_admin" | "user" = "user") {
  const [row] = await db.insert(users).values({ email, password_hash: "irrelevant", full_name: "Target User", role }).returning();
  return row;
}

afterAll(async () => {
  await db.delete(users).where(like(users.email, "admin-users-id-%"));
  await db.delete(coe_domains).where(like(coe_domains.domain_name, "QaAdminUserIdDomain%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/admin/users/[id]", () => {
  it("returns 404 for an unknown id", async () => {
    actingAs(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/admin/users/x"), { params: Promise.resolve({ id: "dead0000-0000-4000-8000-000000000000" }) });
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/admin/users/[id]", () => {
  it("partially updates full_name/is_active", async () => {
    actingAs(authedUser());
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

  it("assigns a COE domain, and rejects a domain_id that doesn't exist", async () => {
    actingAs(authedUser());
    const target = await makeUser(`admin-users-id-domain-${Date.now()}@example.com`);
    const [domain] = await db.insert(coe_domains).values({ domain_name: "QaAdminUserIdDomain X", room_name: "QaAdminUserIdDomain Room X" }).returning();

    const bad = await PUT(
      new NextRequest(`http://localhost/api/admin/users/${target.user_id}`, { method: "PUT", body: JSON.stringify({ domain_id: "00000000-0000-0000-0000-000000000000" }) }),
      { params: Promise.resolve({ id: target.user_id }) },
    );
    expect(bad.status).toBe(400);

    const good = await PUT(
      new NextRequest(`http://localhost/api/admin/users/${target.user_id}`, { method: "PUT", body: JSON.stringify({ domain_id: domain.domain_id }) }),
      { params: Promise.resolve({ id: target.user_id }) },
    );
    expect(good.status).toBe(200);
    const body = (await good.json()) as { domain_id: string };
    expect(body.domain_id).toBe(domain.domain_id);
  });

  it("refuses to demote the only super_admin", async () => {
    actingAs(authedUser());
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
