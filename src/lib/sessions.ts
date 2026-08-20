// Refresh-token issuance, rotation, and reuse (theft) detection, backed by
// the `sessions` table (db/migrations/V2). The raw refresh token only ever
// lives in the client's httpOnly cookie; only its SHA-256 hash is persisted.
//
// Rotation: each refresh marks the presented session revoked + replaced_by
// pointing at a freshly issued session row, chaining rotations together.
// Reuse detection: if a token whose row already has replaced_by set is ever
// presented again, every session for that user is revoked (theft signal) —
// merely revoked-but-not-replaced (e.g. an explicit logout) is just treated
// as invalid, not theft.
import { randomBytes, createHash } from "crypto";
import { eq, and, isNull, lt, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { sessions } from "@/db/schema";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

// JWT_REFRESH_PEPPER is mixed in so a leaked database dump alone can't be
// used to look up valid refresh tokens by their plain SHA-256. The variable
// was documented and deployed by CI but never actually read by any code —
// refresh tokens were hashed unpeppered.
//
// Optional and empty-safe: with no pepper set the digest is identical to the
// old one, so existing sessions keep working. Setting it (or changing it)
// invalidates every outstanding refresh token, which signs everyone out once.
function hashToken(raw: string): string {
  const pepper = process.env.JWT_REFRESH_PEPPER ?? "";
  return createHash("sha256").update(raw).update(pepper).digest("hex");
}

/**
 * Deletes sessions that are already expired or were revoked long enough ago
 * to be useless for reuse detection.
 *
 * Nothing ever reaped this table. With a 30-day TTL and rotation on every
 * 15-minute refresh it grew by roughly 2,880 rows per active user per month,
 * forever. Revoked rows are kept for a grace period rather than deleted
 * immediately, because rotateSession relies on finding an already-rotated row
 * to detect token theft — deleting them eagerly would turn a theft signal
 * into an ordinary "invalid token".
 */
export async function pruneExpiredSessions(db: DbOrTx, revokedGraceDays = 7): Promise<void> {
  const revokedCutoff = new Date(Date.now() - revokedGraceDays * 24 * 60 * 60 * 1000);
  await db
    .delete(sessions)
    .where(or(lt(sessions.expires_at, new Date()), lt(sessions.revoked_at, revokedCutoff)));
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
  db: DbOrTx,
  userId: string,
  meta: SessionMeta = {},
): Promise<IssuedSession> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const [row] = await db
    .insert(sessions)
    .values({
      user_id: userId,
      token_hash: hashToken(rawToken),
      expires_at: expiresAt,
      user_agent: meta.userAgent ?? null,
      ip_address: meta.ipAddress ?? null,
    })
    .returning({ sessionId: sessions.session_id });

  return { rawToken, sessionId: row.sessionId, expiresAt };
}

export type RotateResult =
  | ({ status: "rotated"; userId: string } & IssuedSession)
  | { status: "invalid" }
  | { status: "reused"; userId: string };

export async function rotateSession(
  db: DbOrTx,
  rawToken: string,
  meta: SessionMeta = {},
): Promise<RotateResult> {
  const tokenHash = hashToken(rawToken);
  const [row] = await db.select().from(sessions).where(eq(sessions.token_hash, tokenHash)).limit(1);

  if (!row) return { status: "invalid" };
  if (row.expires_at.getTime() < Date.now()) return { status: "invalid" };

  if (row.replaced_by) {
    await revokeAllSessionsForUser(db, row.user_id);
    return { status: "reused", userId: row.user_id };
  }
  if (row.revoked_at) {
    return { status: "invalid" };
  }

  const next = await createSession(db, row.user_id, meta);

  await db
    .update(sessions)
    .set({ revoked_at: new Date(), replaced_by: next.sessionId })
    .where(eq(sessions.session_id, row.session_id));

  return { status: "rotated", userId: row.user_id, ...next };
}

export async function revokeSession(db: DbOrTx, rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db.update(sessions).set({ revoked_at: new Date() }).where(eq(sessions.token_hash, tokenHash));
}

export async function revokeAllSessionsForUser(db: DbOrTx, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revoked_at: new Date() })
    .where(and(eq(sessions.user_id, userId), isNull(sessions.revoked_at)));
}
