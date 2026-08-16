import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { coe_domains } from "@/db/schema";

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
    domain_id: null,
    ...overrides,
  };
}

afterAll(async () => {
  await db.delete(coe_domains).where(like(coe_domains.domain_name, "QaDomainList%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/coe-domains", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/coe-domains"));
    expect(res.status).toBe(401);
  });

  it("returns domains for any authenticated role", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "user" }));
    await db.insert(coe_domains).values({ domain_name: "QaDomainList AI", room_name: "QaDomainList Lab 1" });
    const res = await GET(new NextRequest("http://localhost/api/coe-domains"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ domain_name: string }>;
    expect(body.some((d) => d.domain_name === "QaDomainList AI")).toBe(true);
  });
});

describe("POST /api/coe-domains", () => {
  it("returns 403 for a non-super_admin user", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "user" }));
    const res = await POST(
      new NextRequest("http://localhost/api/coe-domains", {
        method: "POST",
        body: JSON.stringify({ domain_name: "QaDomainList X", room_name: "QaDomainList Room X" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("creates a domain for a super_admin", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "super_admin" }));
    const res = await POST(
      new NextRequest("http://localhost/api/coe-domains", {
        method: "POST",
        body: JSON.stringify({ domain_name: "QaDomainList Robotics", room_name: "QaDomainList Lab 2" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { domain_name: string; room_name: string };
    expect(body.domain_name).toBe("QaDomainList Robotics");
    expect(body.room_name).toBe("QaDomainList Lab 2");
  });

  it("rejects a duplicate domain or room name", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser({ role: "super_admin" }));
    await POST(
      new NextRequest("http://localhost/api/coe-domains", {
        method: "POST",
        body: JSON.stringify({ domain_name: "QaDomainList Dup", room_name: "QaDomainList Dup Room" }),
      }),
    );
    const res = await POST(
      new NextRequest("http://localhost/api/coe-domains", {
        method: "POST",
        body: JSON.stringify({ domain_name: "QaDomainList Dup Other", room_name: "QaDomainList Dup Room" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});
