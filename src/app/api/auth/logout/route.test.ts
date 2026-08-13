import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { hashPassword } from "@/lib/passwords";
import { POST as login } from "../login/route";
import { POST as refresh } from "../refresh/route";
import { POST as logout } from "./route";

const EMAIL = `logout-test-${Date.now()}@example.com`;
const PASSWORD = "CorrectHorse123!";

beforeAll(async () => {
  await db.insert(users).values({ email: EMAIL, password_hash: await hashPassword(PASSWORD), full_name: "Logout Test User", role: "user", is_active: true });
});

afterAll(async () => {
  const [user] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, EMAIL));
  if (user) {
    await db.delete(sessions).where(eq(sessions.user_id, user.user_id));
    await db.delete(users).where(eq(users.user_id, user.user_id));
  }
});

describe("POST /api/auth/logout", () => {
  it("clears auth cookies and revokes the refresh token so it can no longer refresh", async () => {
    const loginRes = await login(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }));
    const refreshToken = loginRes.cookies.get("refresh_token")!.value;

    const logoutRes = await logout(new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { Cookie: `refresh_token=${refreshToken}` } }));
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.cookies.get("access_token")?.value).toBe("");

    const refreshRes = await refresh(new NextRequest("http://localhost/api/auth/refresh", { method: "POST", headers: { Cookie: `refresh_token=${refreshToken}` } }));
    expect(refreshRes.status).toBe(401);
  });

  it("succeeds even with no refresh_token cookie present", async () => {
    const res = await logout(new NextRequest("http://localhost/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
  });
});
