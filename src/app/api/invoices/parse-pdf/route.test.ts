import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { POST } from "./route";

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
    role: "user",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

function pdfFormData(): FormData {
  const form = new FormData();
  // A real PDF header (%PDF-1.7). file.type is client-declared and trivially
  // spoofed, so the route checks the actual leading bytes before spending a
  // Gemini call on the upload — the old [1,2,3] fixture is now rejected, as
  // any non-PDF should be.
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])], "invoice.pdf", { type: "application/pdf" });
  form.append("pdf", file);
  return form;
}

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  mockRequireUser.mockReset();
  mockGenerateContent.mockReset();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

describe("POST /api/invoices/parse-pdf", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no file is provided", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it("returns 501 when GEMINI_API_KEY is unset", async () => {
    actingAs(authedUser());
    delete process.env.GEMINI_API_KEY;
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(501);
  });

  it("returns 502 when Gemini returns malformed JSON", async () => {
    actingAs(authedUser());
    process.env.GEMINI_API_KEY = "test-key";
    mockGenerateContent.mockResolvedValue({ text: "not valid json" });
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(502);
  });

  it("returns the parsed invoice on success", async () => {
    actingAs(authedUser());
    process.env.GEMINI_API_KEY = "test-key";
    const shape = {
      supplier_name: "Acme Supplies",
      delivery_date: "2026-01-15",
      invoice_number: "INV042",
      products: [{ product_name: "Widget", quantity: 2, unit_price: 10, total: 20 }],
    };
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(shape) });
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(shape);
  });
});
