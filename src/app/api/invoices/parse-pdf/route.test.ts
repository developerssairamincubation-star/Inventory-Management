import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { POST } from "./route";

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

function pdfFormData(): FormData {
  const form = new FormData();
  const file = new File([new Uint8Array([1, 2, 3])], "invoice.pdf", { type: "application/pdf" });
  form.append("pdf", file);
  return form;
}

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGenerateContent.mockReset();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

describe("POST /api/invoices/parse-pdf", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no file is provided", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it("returns 501 when GEMINI_API_KEY is unset", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    delete process.env.GEMINI_API_KEY;
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(501);
  });

  it("returns 502 when Gemini returns malformed JSON", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    process.env.GEMINI_API_KEY = "test-key";
    mockGenerateContent.mockResolvedValue({ text: "not valid json" });
    const res = await POST(new NextRequest("http://localhost/api/invoices/parse-pdf", { method: "POST", body: pdfFormData() }));
    expect(res.status).toBe(502);
  });

  it("returns the parsed invoice on success", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
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
