import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, purchase_invoice } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);
let OWNER_ID: string;

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: OWNER_ID,
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

beforeAll(async () => {
  const [owner] = await db.insert(users).values({ email: `invoices-next-number-owner-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Next Number Owner" }).returning();
  OWNER_ID = owner.user_id;
});

afterAll(async () => {
  await db.delete(purchase_invoice).where(eq(purchase_invoice.user_id, OWNER_ID));
  await db.delete(users).where(eq(users.user_id, OWNER_ID));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/invoices/next-number", () => {
  it("returns INV001 when the user has no invoices yet", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await GET(new NextRequest("http://localhost/api/invoices/next-number"));
    const body = (await res.json()) as { invoice_no: string };
    expect(body.invoice_no).toBe("INV001");
  });

  it("is a pure preview: calling it repeatedly does not consume/change anything", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    await db.insert(purchase_invoice).values({ invoice_number: "INV005", supplier_name: "S", received_date: "2026-01-01", total_amount: "0", user_id: OWNER_ID });

    const first = (await (await GET(new NextRequest("http://localhost/api/invoices/next-number"))).json()) as { invoice_no: string };
    const second = (await (await GET(new NextRequest("http://localhost/api/invoices/next-number"))).json()) as { invoice_no: string };
    expect(first.invoice_no).toBe("INV006");
    expect(second.invoice_no).toBe("INV006");
  });

  it("scopes the sequence per user", async () => {
    const [otherOwner] = await db.insert(users).values({ email: `invoices-next-number-other-${Date.now()}@example.com`, password_hash: "irrelevant", full_name: "Other Owner" }).returning();
    mockGetAuthUser.mockResolvedValue(authedUser({ user_id: otherOwner.user_id }));

    const res = await GET(new NextRequest("http://localhost/api/invoices/next-number"));
    const body = (await res.json()) as { invoice_no: string };
    expect(body.invoice_no).toBe("INV001"); // unaffected by OWNER_ID's INV005 above

    await db.delete(users).where(eq(users.user_id, otherOwner.user_id));
  });
});
