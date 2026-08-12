// Integration test against the real inventory_test Postgres database (not
// mocks — Vitest points DATABASE_URL at it, see vitest.setup.ts). Schema
// correctness (FK to users, rotation chain via replaced_by) is exactly what
// this migration needs to get right.
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { createSession, rotateSession, revokeSession } from "./sessions";

async function makeTestUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `sessions-test-${label}-${Date.now()}@example.com`,
      password_hash: "irrelevant-for-this-test",
      full_name: "Session Test User",
    })
    .returning();
  return user;
}

afterAll(async () => {
  await db.delete(users).where(like(users.email, "sessions-test-%"));
  await pool.end();
});

describe("sessions (refresh-token issuance, rotation, reuse detection)", () => {
  it("creates a session row whose hash matches the issued raw token", async () => {
    const user = await makeTestUser("create");
    const issued = await createSession(db, user.user_id);

    const [row] = await db.select().from(sessions).where(eq(sessions.session_id, issued.sessionId));
    expect(row.user_id).toBe(user.user_id);
    expect(row.revoked_at).toBeNull();
    expect(row.token_hash).not.toEqual(issued.rawToken);
  });

  it("rotates a valid session: old row revoked + replaced_by set, new token issued", async () => {
    const user = await makeTestUser("rotate");
    const first = await createSession(db, user.user_id);

    const result = await rotateSession(db, first.rawToken);
    expect(result.status).toBe("rotated");
    if (result.status !== "rotated") throw new Error("unreachable");
    expect(result.rawToken).not.toEqual(first.rawToken);

    const [oldRow] = await db.select().from(sessions).where(eq(sessions.session_id, first.sessionId));
    expect(oldRow.revoked_at).not.toBeNull();
    expect(oldRow.replaced_by).toBe(result.sessionId);
  });

  it("treats reuse of an already-rotated token as theft and revokes every session for that user", async () => {
    const user = await makeTestUser("reuse");
    const first = await createSession(db, user.user_id);
    const second = await createSession(db, user.user_id);
    await rotateSession(db, first.rawToken); // rotates `first` away

    const reuseResult = await rotateSession(db, first.rawToken); // present the now-stale token again
    expect(reuseResult.status).toBe("reused");

    const [secondRow] = await db.select().from(sessions).where(eq(sessions.session_id, second.sessionId));
    expect(secondRow.revoked_at).not.toBeNull(); // collateral session for the same user also revoked
  });

  it("returns invalid (not reused) for a token that was explicitly logged out, never rotated", async () => {
    const user = await makeTestUser("logout");
    const issued = await createSession(db, user.user_id);
    await revokeSession(db, issued.rawToken);

    const result = await rotateSession(db, issued.rawToken);
    expect(result.status).toBe("invalid");
  });

  it("returns invalid for an expired session", async () => {
    const user = await makeTestUser("expired");
    const issued = await createSession(db, user.user_id);
    await db.update(sessions).set({ expires_at: new Date(Date.now() - 1000) }).where(eq(sessions.session_id, issued.sessionId));

    const result = await rotateSession(db, issued.rawToken);
    expect(result.status).toBe("invalid");
  });

  it("returns invalid for an unknown token", async () => {
    const result = await rotateSession(db, "not-a-real-token");
    expect(result.status).toBe("invalid");
  });
});
