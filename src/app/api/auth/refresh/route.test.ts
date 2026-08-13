// Real-stack test: login -> refresh -> verify rotation, then verify reuse
// of the pre-rotation refresh token is treated as theft (all sessions
// revoked) — the property src/lib/sessions.ts's unit tests already prove in
// isolation; this confirms the actual route wires it up correctly.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { hashPassword } from "@/lib/passwords";
import { POST as login } from "../login/route";
import { POST as refresh } from "./route";

const EMAIL = `refresh-test-${Date.now()}@example.com`;
const PASSWORD = "CorrectHorse123!";

beforeAll(async () => {
  await db.insert(users).values({ email: EMAIL, password_hash: await hashPassword(PASSWORD), full_name: "Refresh Test User", role: "user", is_active: true });
});

afterAll(async () => {
  const [user] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, EMAIL));
  if (user) {
    await db.delete(sessions).where(eq(sessions.user_id, user.user_id));
    await db.delete(users).where(eq(users.user_id, user.user_id));
  }
});

async function doLogin() {
  const res = await login(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }));
  return { accessToken: res.cookies.get("access_token")!.value, refreshToken: res.cookies.get("refresh_token")!.value };
}

describe("POST /api/auth/refresh", () => {
  it("returns 401 with no refresh_token cookie", async () => {
    const res = await refresh(new NextRequest("http://localhost/api/auth/refresh", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rotates: issues a new access+refresh token pair, old refresh token stops working", async () => {
    const { refreshToken } = await doLogin();

    const res1 = await refresh(new NextRequest("http://localhost/api/auth/refresh", { method: "POST", headers: { Cookie: `refresh_token=${refreshToken}` } }));
    expect(res1.status).toBe(200);
    const newRefreshToken = res1.cookies.get("refresh_token")!.value;
    expect(newRefreshToken).not.toBe(refreshToken);

    // Presenting the OLD (pre-rotation) refresh token again is theft-signal reuse.
    const res2 = await refresh(new NextRequest("http://localhost/api/auth/refresh", { method: "POST", headers: { Cookie: `refresh_token=${refreshToken}` } }));
    expect(res2.status).toBe(401);

    // Reuse detection revokes the WHOLE chain — even the just-issued new token stops working.
    const res3 = await refresh(new NextRequest("http://localhost/api/auth/refresh", { method: "POST", headers: { Cookie: `refresh_token=${newRefreshToken}` } }));
    expect(res3.status).toBe(401);
  });
});
