// Access-token signing/verification using `jose` — pure Web Crypto API, so
// this module also runs in the Edge runtime (needed by middleware.ts, wired
// up in Phase 4). `jsonwebtoken` doesn't run in Edge and was deliberately
// not used here for that reason.
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

function getAccessSecret(): Uint8Array {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role } satisfies Partial<JWTPayload> & Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(getAccessSecret());
}

/**
 * Signature + expiry verification only — no DB lookup. Safe to call from the
 * Edge runtime (middleware.ts). Callers that need the authoritative check
 * (is_active, current role) must still hit the DB — see
 * src/lib/authMiddleware.ts, wired up in Phase 4.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getAccessSecret());
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
