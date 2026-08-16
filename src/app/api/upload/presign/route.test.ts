// The route only signs upload params now (the actual upload happens
// browser-to-Cloudinary directly) — signing is pure HMAC math, so this is a
// plain unit test with no network dependency, unlike the old MinIO-backed
// integration test this replaces.
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { POST } from "./route";

describe("POST /api/upload/presign", () => {
  it("returns 400 for an unsupported mime type", async () => {
    const res = await POST(new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "application/pdf" }) }));
    expect(res.status).toBe(400);
  });

  it("returns a signature matching independently-recomputed Cloudinary signing math", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "image/png", folder: "products" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploadUrl: string; apiKey: string; timestamp: number; signature: string; folder: string };

    expect(body.folder).toMatch(/\/products$/);
    expect(body.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`);
    expect(body.apiKey).toBe(process.env.CLOUDINARY_API_KEY);

    const expectedSignature = cloudinary.utils.api_sign_request(
      { timestamp: body.timestamp, folder: body.folder },
      process.env.CLOUDINARY_API_SECRET!
    );
    expect(body.signature).toBe(expectedSignature);
  });
});
