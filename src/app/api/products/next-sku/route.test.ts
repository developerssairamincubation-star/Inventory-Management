import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { category, id_sequences } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { GET } from "./route";

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
  await db.delete(category).where(like(category.category_name, "QaNextSkuCategory%"));
  await db.delete(id_sequences).where(like(id_sequences.sequence_key, "sku:QaNextSku%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("GET /api/products/next-sku", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/products/next-sku"));
    expect(res.status).toBe(401);
  });

  it("previews GEN-0001 with no category and no existing sequence row", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    // Only safe to assert the prefix here — the uncategorized sequence is
    // shared across the whole test suite, so its current value is not
    // predictable in isolation.
    const res = await GET(new NextRequest("http://localhost/api/products/next-sku"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sku: string };
    expect(body.sku).toMatch(/^GEN-\d{4}$/);
  });

  it("is a pure preview: calling it repeatedly does not change the value", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "QaNextSkuCategory Pure", code: "QNS" }).returning();

    const first = (await (await GET(new NextRequest(`http://localhost/api/products/next-sku?category_id=${cat.category_id}`))).json()) as { sku: string };
    const second = (await (await GET(new NextRequest(`http://localhost/api/products/next-sku?category_id=${cat.category_id}`))).json()) as { sku: string };
    expect(first.sku).toBe("QNS-0001");
    expect(second.sku).toBe("QNS-0001");
  });

  it("previews the next value from an existing sequence row without consuming it", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "QaNextSkuCategory Existing", code: "QNE" }).returning();
    await db.insert(id_sequences).values({ sequence_key: `sku:${cat.category_id}`, current_value: 4, prefix: "QNE", pad_width: 4 });

    const res = await GET(new NextRequest(`http://localhost/api/products/next-sku?category_id=${cat.category_id}`));
    const body = (await res.json()) as { sku: string };
    expect(body.sku).toBe("QNE-0005");

    const [row] = await db.select({ current_value: id_sequences.current_value }).from(id_sequences).where(eq(id_sequences.sequence_key, `sku:${cat.category_id}`));
    expect(row.current_value).toBe(4); // unchanged — preview only
  });

  it("suggests a unique prefix (not the shared GEN fallback) when the category has no code set", async () => {
    // Two categories without a code must never both preview "GEN" — that
    // literal is reserved for genuinely uncategorized products, and two
    // categories sharing it would generate colliding SKUs (see suggestCategoryCode).
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [cat] = await db.insert(category).values({ category_name: "QaNextSkuCategory NoCode" }).returning();

    const res = await GET(new NextRequest(`http://localhost/api/products/next-sku?category_id=${cat.category_id}`));
    const body = (await res.json()) as { sku: string };
    expect(body.sku).toMatch(/^QA-\d{4}$/);
    expect(body.sku).not.toMatch(/^GEN-/);
  });
});
