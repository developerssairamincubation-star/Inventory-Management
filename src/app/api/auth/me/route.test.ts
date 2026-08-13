// Real-stack test: login -> use the issued access_token cookie against the
// real authMiddleware.getAuthUser -> /api/auth/me.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { hashPassword } from "@/lib/passwords";
import { POST as login } from "../login/route";
import { GET as me } from "./route";

const EMAIL = `me-test-${Date.now()}@example.com`;
const PASSWORD = "CorrectHorse123!";

beforeAll(async () => {
  await db.insert(users).values({ email: EMAIL, password_hash: await hashPassword(PASSWORD), full_name: "Me Test User", role: "user", is_active: true });
});

afterAll(async () => {
  const [user] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, EMAIL));
  if (user) {
    await db.delete(sessions).where(eq(sessions.user_id, user.user_id));
    await db.delete(users).where(eq(users.user_id, user.user_id));
  }
});

describe("GET /api/auth/me", () => {
  it("returns 401 with no cookies at all", async () => {
    const res = await me(new NextRequest("http://localhost/api/auth/me"));
    expect(res.status).toBe(401);
  });

  it("returns the user profile for a valid access_token cookie from a real login", async () => {
    const loginRes = await login(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }));
    const accessToken = loginRes.cookies.get("access_token")!.value;

    const meRes = await me(new NextRequest("http://localhost/api/auth/me", { headers: { Cookie: `access_token=${accessToken}` } }));
    expect(meRes.status).toBe(200);
    const body = (await meRes.json()) as { email: string; full_name: string; role: string };
    expect(body).toMatchObject({ email: EMAIL, full_name: "Me Test User", role: "user" });
  });
});
