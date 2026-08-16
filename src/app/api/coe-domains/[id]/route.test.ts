import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { coe_domains, users } from "@/db/schema";

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
    domain_id: null,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(users).where(like(users.email, "qa-domain-item-%"));
  await db.delete(coe_domains).where(like(coe_domains.domain_name, "QaDomainItem%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("PUT /api/coe-domains/[id]", () => {
  it("renames an existing domain", async () => {
    const [domain] = await db.insert(coe_domains).values({ domain_name: "QaDomainItem Before", room_name: "QaDomainItem Room Before" }).returning();
    mockGetAuthUser.mockResolvedValue(authedUser());

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
    mockGetAuthUser.mockResolvedValue(authedUser());

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
    mockGetAuthUser.mockResolvedValue(authedUser());

    const res = await DELETE(new NextRequest(`http://localhost/api/coe-domains/${domain.domain_id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: domain.domain_id }),
    });
    expect(res.status).toBe(409);

    // cleanup: clear the reference so the afterAll domain cleanup can run
    await db.update(users).set({ domain_id: null }).where(eq(users.user_id, user.user_id));
  });
});
