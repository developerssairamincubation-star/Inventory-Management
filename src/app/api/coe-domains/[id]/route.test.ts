import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { coe_domains, users } from "@/db/schema";

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
  await db.delete(users).where(like(users.email, "qa-domain-item-%"));
  await db.delete(coe_domains).where(like(coe_domains.domain_name, "QaDomainItem%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("PUT /api/coe-domains/[id]", () => {
  it("renames an existing domain", async () => {
    const [domain] = await db.insert(coe_domains).values({ domain_name: "QaDomainItem Before", room_name: "QaDomainItem Room Before" }).returning();
    actingAs(authedUser());

    const res = await PUT(
      new NextRequest(`http://localhost/api/coe-domains/${domain.domain_id}`, {
        method: "PUT",
        body: JSON.stringify({ domain_name: "QaDomainItem After", room_name: "QaDomainItem Room After" }),
      }),
      { params: Promise.resolve({ id: domain.domain_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain_name: string };
    expect(body.domain_name).toBe("QaDomainItem After");
  });
});

describe("DELETE /api/coe-domains/[id]", () => {
  it("deletes a domain with no references", async () => {
    const [domain] = await db.insert(coe_domains).values({ domain_name: "QaDomainItem ToDelete", room_name: "QaDomainItem Room ToDelete" }).returning();
    actingAs(authedUser());

    const res = await DELETE(new NextRequest(`http://localhost/api/coe-domains/${domain.domain_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: domain.domain_id }),
    });
    expect(res.status).toBe(200);
  });

  it("blocks deletion while a user is still assigned to the domain", async () => {
    const [domain] = await db.insert(coe_domains).values({ domain_name: "QaDomainItem Referenced", room_name: "QaDomainItem Room Referenced" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `qa-domain-item-${Date.now()}@example.com`, full_name: "QA User", password_hash: "x", domain_id: domain.domain_id })
      .returning();
    actingAs(authedUser());

    const res = await DELETE(new NextRequest(`http://localhost/api/coe-domains/${domain.domain_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: domain.domain_id }),
    });
    expect(res.status).toBe(409);

    // cleanup: clear the reference so the afterAll domain cleanup can run
    await db.update(users).set({ domain_id: null }).where(eq(users.user_id, user.user_id));
  });
});
