// Refresh-token issuance, rotation, and reuse (theft) detection, backed by
// the `sessions` table (db/migrations/V2). The raw refresh token only ever
// lives in the client's httpOnly cookie; only its SHA-256 hash is persisted.
//
// Rotation: each refresh marks the presented session revoked + replacedBy
// pointing at a freshly issued session row, chaining rotations together.
// Reuse detection: if a token whose row already has replacedBy set is ever
// presented again, every session for that user is revoked (theft signal) —
// merely revoked-but-not-replaced (e.g. an explicit logout) is just treated
// as invalid, not theft.
import { randomBytes, createHash } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import type { db as DbType } from "@/db/client";
import { sessions } from "@/db/schema";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface SessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedSession {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createSession(
  db: typeof DbType,
  userId: string,
  meta: SessionMeta = {},
): Promise<IssuedSession> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    })
    .returning({ sessionId: sessions.sessionId });

  return { rawToken, sessionId: row.sessionId, expiresAt };
}

export type RotateResult =
  | ({ status: "rotated"; userId: string } & IssuedSession)
  | { status: "invalid" }
  | { status: "reused"; userId: string };

export async function rotateSession(
  db: typeof DbType,
  rawToken: string,
  meta: SessionMeta = {},
): Promise<RotateResult> {
  const tokenHash = hashToken(rawToken);
  const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);

  if (!row) return { status: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "invalid" };

  if (row.replacedBy) {
    await revokeAllSessionsForUser(db, row.userId);
    return { status: "reused", userId: row.userId };
  }
  if (row.revokedAt) {
    return { status: "invalid" };
  }

  const next = await createSession(db, row.userId, meta);

  await db
    .update(sessions)
    .set({ revokedAt: new Date(), replacedBy: next.sessionId })
    .where(eq(sessions.sessionId, row.sessionId));

  return { status: "rotated", userId: row.userId, ...next };
}

export async function revokeSession(db: typeof DbType, rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
}

export async function revokeAllSessionsForUser(db: typeof DbType, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
