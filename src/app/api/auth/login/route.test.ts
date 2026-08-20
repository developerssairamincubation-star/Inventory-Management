// Exercises the real auth stack end-to-end (no authMiddleware mock, unlike
// every other route test) — this IS the thing being verified.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { hashPassword } from "@/lib/passwords";
import { verifyAccessToken } from "@/lib/jwt";
import { POST as login } from "./route";

const EMAIL = `login-test-${Date.now()}@example.com`;
const PASSWORD = "CorrectHorse123!";

beforeAll(async () => {
  await db.insert(users).values({
    email: EMAIL,
    password_hash: await hashPassword(PASSWORD),
    full_name: "Login Test User",
    role: "user",
    is_active: true,
    domain_id: null,
  });
});

afterAll(async () => {
  const [user] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, EMAIL));
  if (user) {
    await db.delete(sessions).where(eq(sessions.user_id, user.user_id));
    await db.delete(users).where(eq(users.user_id, user.user_id));
  }
});

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/auth/login", () => {
  it("returns 401 for a wrong password", async () => {
    const res = await login(jsonRequest({ email: EMAIL, password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown email", async () => {
    const res = await login(jsonRequest({ email: "nobody@example.com", password: PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("logs in with correct credentials, case-insensitively, and sets working auth cookies", async () => {
    const res = await login(jsonRequest({ email: EMAIL.toUpperCase(), password: PASSWORD }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { email: string; role: string };
    expect(body.email).toBe(EMAIL);

    const accessCookie = res.cookies.get("access_token");
    const refreshCookie = res.cookies.get("refresh_token");
    const csrfCookie = res.cookies.get("csrf_token");
    expect(accessCookie?.value).toBeTruthy();
    expect(refreshCookie?.value).toBeTruthy();
    expect(csrfCookie?.value).toBeTruthy();
    expect(accessCookie?.httpOnly).toBe(true);
    expect(csrfCookie?.httpOnly).toBeFalsy();

    const claims = await verifyAccessToken(accessCookie!.value);
    expect(claims?.email).toBe(EMAIL);
    expect(claims?.role).toBe("user");
  });

  // Deliberately the same 401 (and message) a wrong password gets. A distinct
  // 403 ACCOUNT_DISABLED told an attacker the address was a real account.
  it("rejects a disabled account with the same 401 as a wrong password", async () => {
    const disabledEmail = `login-disabled-${Date.now()}@example.com`;
    await db.insert(users).values({ email: disabledEmail, password_hash: await hashPassword(PASSWORD), full_name: "Disabled", role: "user", is_active: false });

    const res = await login(jsonRequest({ email: disabledEmail, password: PASSWORD }));
    expect(res.status).toBe(401);

    await db.delete(users).where(eq(users.email, disabledEmail));
  });
});
