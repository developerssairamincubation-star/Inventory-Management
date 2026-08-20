// Access-token signing/verification using `jose` — pure Web Crypto API, so
// this module also runs in the Edge runtime (needed by middleware.ts).
// `jsonwebtoken` doesn't run in Edge and was deliberately not used here.
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

// HS256 keys shorter than the hash output add no security beyond their own
// length. Nothing checked this before, so a one-character JWT_ACCESS_SECRET
// started cleanly and signed perfectly valid — and trivially forgeable —
// tokens.
const MIN_SECRET_LENGTH = 32;

// Pinning both means a token minted for a different system that happens to
// share this secret won't verify here, and vice versa.
export const JWT_ISSUER = "inventory-management";
export const JWT_AUDIENCE = "inventory-management-api";

function getAccessSecret(): Uint8Array {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
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
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(getAccessSecret());
}

/**
 * Signature + expiry + issuer/audience verification only — no DB lookup. Safe
 * to call from the Edge runtime.
 *
 * The `role` claim it returns is a hint, never an authorization decision:
 * requireUser() re-reads role and is_active from the database on every
 * request, so a demoted or deactivated account loses access immediately
 * rather than at the next token expiry.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    // `algorithms` is pinned explicitly. jose already restricts to HMAC when
    // given a symmetric key, so this is belt-and-braces against a future
    // refactor that swaps in an asymmetric one and reopens alg confusion.
    const { payload } = await jwtVerify(token, getAccessSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
