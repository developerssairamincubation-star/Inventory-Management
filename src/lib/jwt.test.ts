import { describe, it, expect, beforeAll } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt";

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET ??= "test-only-access-secret-not-for-real-use";
});

describe("jwt access tokens", () => {
  it("round-trips claims through sign + verify", async () => {
    const token = await signAccessToken({ sub: "user-123", email: "a@b.com", role: "user" });
    const claims = await verifyAccessToken(token);
    expect(claims).toEqual({ sub: "user-123", email: "a@b.com", role: "user" });
  });

  it("rejects a tampered token", async () => {
    const token = await signAccessToken({ sub: "user-123", email: "a@b.com", role: "user" });
    const tampered = token.slice(0, -2) + (token.slice(-2) === "aa" ? "bb" : "aa");
    await expect(verifyAccessToken(tampered)).resolves.toBeNull();
  });

  it("rejects garbage input", async () => {
    await expect(verifyAccessToken("not-a-jwt")).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken({ sub: "user-123", email: "a@b.com", role: "user" });
    const originalSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = "a-completely-different-secret";
    await expect(verifyAccessToken(token)).resolves.toBeNull();
    process.env.JWT_ACCESS_SECRET = originalSecret;
  });
});
