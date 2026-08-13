// Integration test against the real local MinIO container — round-trips an
// actual file through the presigned-PUT flow (not mocked), since the whole
// point of this route is that the returned URL genuinely works against
// S3-compatible storage.
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "@/lib/s3";
import { POST } from "./route";

describe("POST /api/upload/presign", () => {
  it("returns 400 for an unsupported mime type", async () => {
    const res = await POST(new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "application/pdf" }) }));
    expect(res.status).toBe(400);
  });

  it("issues a presigned URL that a real PUT can upload through, ending up at the returned public url", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/upload/presign", { method: "POST", body: JSON.stringify({ mimeType: "image/png", folder: "products" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploadUrl: string; url: string; key: string };
    expect(body.key).toMatch(/^products\/.+\.png$/);

    const fakeImageBytes = Buffer.from("fake-png-bytes-for-test");
    const putRes = await fetch(body.uploadUrl, { method: "PUT", body: fakeImageBytes, headers: { "Content-Type": "image/png" } });
    expect(putRes.ok).toBe(true);

    const getRes = await fetch(body.url);
    expect(getRes.ok).toBe(true);
    const downloaded = Buffer.from(await getRes.arrayBuffer());
    expect(downloaded.equals(fakeImageBytes)).toBe(true);

    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: body.key }));
  });
});
