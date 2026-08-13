import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes, createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions, password_reset_tokens } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { createSession } from "@/lib/sessions";
import { POST as resetPassword } from "./route";

const EMAIL = `reset-password-test-${Date.now()}@example.com`;

async function makeResetToken(userId: string, overrides: { expiresAt?: Date; usedAt?: Date } = {}) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await db.insert(password_reset_tokens).values({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    used_at: overrides.usedAt,
  });
  return rawToken;
}

let userId: string;

beforeAll(async () => {
  const [user] = await db.insert(users).values({ email: EMAIL, password_hash: await hashPassword("OldPassword123!"), full_name: "Reset Password Test User", role: "user", is_active: true }).returning();
  userId = user.user_id;
});

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.user_id, userId));
  await db.delete(password_reset_tokens).where(eq(password_reset_tokens.user_id, userId));
  await db.delete(users).where(eq(users.user_id, userId));
});

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/reset-password", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/auth/reset-password", () => {
  it("returns 400 for an unknown token", async () => {
    const res = await resetPassword(jsonRequest({ token: "not-a-real-token", password: "NewPassword123!" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an expired token", async () => {
    const token = await makeResetToken(userId, { expiresAt: new Date(Date.now() - 1000) });
    const res = await resetPassword(jsonRequest({ token, password: "NewPassword123!" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an already-used token", async () => {
    const token = await makeResetToken(userId, { usedAt: new Date() });
    const res = await resetPassword(jsonRequest({ token, password: "NewPassword123!" }));
    expect(res.status).toBe(400);
  });

  it("updates the password, marks the token used, and revokes all existing sessions", async () => {
    const session = await createSession(db, userId);
    const token = await makeResetToken(userId);

    const res = await resetPassword(jsonRequest({ token, password: "BrandNewPassword123!" }));
    expect(res.status).toBe(200);

    const [user] = await db.select({ password_hash: users.password_hash }).from(users).where(eq(users.user_id, userId));
    await expect(verifyPassword("BrandNewPassword123!", user.password_hash)).resolves.toBe(true);

    const [sessionRow] = await db.select({ revoked_at: sessions.revoked_at }).from(sessions).where(eq(sessions.session_id, session.sessionId));
    expect(sessionRow.revoked_at).not.toBeNull();

    // Token cannot be reused.
    const secondAttempt = await resetPassword(jsonRequest({ token, password: "AnotherPassword123!" }));
    expect(secondAttempt.status).toBe(400);
  });
});
