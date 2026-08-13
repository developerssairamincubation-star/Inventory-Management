// Real-stack test: verifies an actual email lands in the local Mailpit
// container (not mocked) — the whole point of this route is that the reset
// link genuinely gets delivered.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, password_reset_tokens } from "@/db/schema";
import { hashPassword } from "@/lib/passwords";
import { POST as forgotPassword } from "./route";

const EMAIL = `forgot-password-test-${Date.now()}@example.com`;
const MAILPIT_API = "http://localhost:8025/api/v1";

beforeAll(async () => {
  await db.insert(users).values({ email: EMAIL, password_hash: await hashPassword("whatever"), full_name: "Forgot Password Test User", role: "user", is_active: true });
});

afterAll(async () => {
  const [user] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, EMAIL));
  if (user) {
    await db.delete(password_reset_tokens).where(eq(password_reset_tokens.user_id, user.user_id));
    await db.delete(users).where(eq(users.user_id, user.user_id));
  }
});

describe("POST /api/auth/forgot-password", () => {
  it("returns success without leaking whether the email is registered", async () => {
    const res = await forgotPassword(new NextRequest("http://localhost/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: "nobody@example.com" }) }));
    expect(res.status).toBe(200);
  });

  it("creates a reset token and delivers a real email to Mailpit", async () => {
    const res = await forgotPassword(new NextRequest("http://localhost/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: EMAIL }) }));
    expect(res.status).toBe(200);

    const [user] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, EMAIL));
    const [tokenRow] = await db.select().from(password_reset_tokens).where(eq(password_reset_tokens.user_id, user.user_id));
    expect(tokenRow).toBeDefined();
    expect(tokenRow.used_at).toBeNull();

    // Mailpit indexes asynchronously; poll briefly.
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      const searchRes = await fetch(`${MAILPIT_API}/search?query=to:${encodeURIComponent(EMAIL)}`);
      const searchBody = (await searchRes.json()) as { messages: Array<{ Subject: string }> };
      found = searchBody.messages.some((m) => m.Subject === "Reset your password");
      if (!found) await new Promise((r) => setTimeout(r, 200));
    }
    expect(found).toBe(true);
  });
});
