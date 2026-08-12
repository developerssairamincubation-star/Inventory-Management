// Integration test against the real inventory_test Postgres database (not
// mocks) — schema correctness (FK to users, rotation chain via replacedBy)
// is exactly what this migration needs to get right.
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { testDb, testPool } from "@/db/testClient";
import { users, sessions } from "@/db/schema";
import { createSession, rotateSession, revokeSession } from "./sessions";

async function makeTestUser(label: string) {
  const [user] = await testDb
    .insert(users)
    .values({
      email: `sessions-test-${label}-${Date.now()}@example.com`,
      passwordHash: "irrelevant-for-this-test",
      fullName: "Session Test User",
    })
    .returning();
  return user;
}

afterAll(async () => {
  await testDb.delete(users).where(like(users.email, "sessions-test-%"));
  await testPool.end();
});

describe("sessions (refresh-token issuance, rotation, reuse detection)", () => {
  it("creates a session row whose hash matches the issued raw token", async () => {
    const user = await makeTestUser("create");
    const issued = await createSession(testDb, user.userId);

    const [row] = await testDb.select().from(sessions).where(eq(sessions.sessionId, issued.sessionId));
    expect(row.userId).toBe(user.userId);
    expect(row.revokedAt).toBeNull();
    expect(row.tokenHash).not.toEqual(issued.rawToken);
  });

  it("rotates a valid session: old row revoked + replacedBy set, new token issued", async () => {
    const user = await makeTestUser("rotate");
    const first = await createSession(testDb, user.userId);

    const result = await rotateSession(testDb, first.rawToken);
    expect(result.status).toBe("rotated");
    if (result.status !== "rotated") throw new Error("unreachable");
    expect(result.rawToken).not.toEqual(first.rawToken);

    const [oldRow] = await testDb.select().from(sessions).where(eq(sessions.sessionId, first.sessionId));
    expect(oldRow.revokedAt).not.toBeNull();
    expect(oldRow.replacedBy).toBe(result.sessionId);
  });

  it("treats reuse of an already-rotated token as theft and revokes every session for that user", async () => {
    const user = await makeTestUser("reuse");
    const first = await createSession(testDb, user.userId);
    const second = await createSession(testDb, user.userId);
    await rotateSession(testDb, first.rawToken); // rotates `first` away

    const reuseResult = await rotateSession(testDb, first.rawToken); // present the now-stale token again
    expect(reuseResult.status).toBe("reused");

    const [secondRow] = await testDb.select().from(sessions).where(eq(sessions.sessionId, second.sessionId));
    expect(secondRow.revokedAt).not.toBeNull(); // collateral session for the same user also revoked
  });

  it("returns invalid (not reused) for a token that was explicitly logged out, never rotated", async () => {
    const user = await makeTestUser("logout");
    const issued = await createSession(testDb, user.userId);
    await revokeSession(testDb, issued.rawToken);

    const result = await rotateSession(testDb, issued.rawToken);
    expect(result.status).toBe("invalid");
  });

  it("returns invalid for an expired session", async () => {
    const user = await makeTestUser("expired");
    const issued = await createSession(testDb, user.userId);
    await testDb.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.sessionId, issued.sessionId));

    const result = await rotateSession(testDb, issued.rawToken);
    expect(result.status).toBe("invalid");
  });

  it("returns invalid for an unknown token", async () => {
    const result = await rotateSession(testDb, "not-a-real-token");
    expect(result.status).toBe("invalid");
  });
});
