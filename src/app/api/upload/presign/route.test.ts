// The route only signs upload params now (the actual upload happens
// browser-to-Cloudinary directly) — signing is pure HMAC math, so this is a
// plain unit test with no network dependency, unlike the old MinIO-backed
// integration test this replaces.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { POST } from "./route";

const mockRequireUser = vi.mocked(requireUser);

function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "00000000-0000-0000-0000-000000000000",
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockRequireUser.mockReset();
  actingAs(authedUser());
});

describe("POST /api/upload/presign", () => {
  // This route had no authentication at all — the only gate was the Edge
  // middleware, which checks a JWT signature but not is_active, not the
  // current role, and not CSRF. This test exists because that gap did.
  it("rejects an unauthenticated caller", async () => {
    actingAs(null);
    const res = await POST(new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "image/png" }) }));
    expect(res.status).toBe(401);
  });

  it("refuses a folder outside the allowlist", async () => {
    // The folder was interpolated straight into the signed path, so a caller
    // could aim an upload at any folder in the account — including another
    // environment's.
    const res = await POST(
      new NextRequest("http://localhost/api/upload/presign", {
        method: "POST",
        body: JSON.stringify({ mimeType: "image/png", folder: "../production" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unsupported mime type", async () => {
    const res = await POST(new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "video/mp4" }) }));
    expect(res.status).toBe(400);
  });

  it("allows application/pdf (invoice document uploads)", async () => {
    const res = await POST(new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "application/pdf", folder: "invoices" }) }));
    expect(res.status).toBe(200);
  });

  it("returns a signature matching independently-recomputed Cloudinary signing math", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "image/png", folder: "products" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploadUrl: string; apiKey: string; timestamp: number; signature: string; folder: string; allowedFormats: string };

    expect(body.folder).toMatch(/\/products$/);
    expect(body.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`);
    expect(body.apiKey).toBe(process.env.CLOUDINARY_API_KEY);

    // allowed_formats is part of the signature now, so Cloudinary enforces
    // the file type rather than trusting the type we were told when signing.
    expect(body.allowedFormats).toBe("png");
    const expectedSignature = cloudinary.utils.api_sign_request(
      { timestamp: body.timestamp, folder: body.folder, allowed_formats: body.allowedFormats },
      process.env.CLOUDINARY_API_SECRET!
    );
    expect(body.signature).toBe(expectedSignature);
  });
});
