// The single authorization policy layer.
//
// Authorization used to be re-derived per route with a copy-pasted
// `const isAdmin = user.role === 'super_admin'` ternary — roughly twenty
// hand-written variants of the same rule. Four routes simply forgot it
// (/api/upload/presign, /api/stocks/[id], /api/students/[id], and both
// /api/categories handlers), which is the failure mode that arrangement
// invites. Every route now derives its predicate from here instead, so
// "what may this user see?" is answered in exactly one place.
//
// Tenancy: the COE domain is the boundary. Everyone assigned to a COE shares
// that COE's inventory; a super_admin sees every domain. Products and
// invoices carry no domain_id of their own — a row's domain is whichever COE
// its owning user belongs to (users.domain_id), the same derivation the
// transfer route already relies on — so those scope through a subquery over
// users. lending_order carries domain_id directly and scopes on it.

import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, products, purchase_invoice, lending_order } from '@/db/schema'
import { verifyAccessToken } from '@/lib/jwt'
import { logger, requestIdFrom } from '@/lib/logger'
import { enforceIpRateLimit } from '@/lib/rateLimit'

export type AuthUser = {
  user_id: string
  email: string
  full_name: string
  role: 'super_admin' | 'user'
  is_active: boolean
  domain_id: string | null
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// ── Scope ────────────────────────────────────────────────────────────────

export type Scope =
  /** super_admin — every domain. */
  | { kind: 'all' }
  /** A user assigned to a COE — that COE's rows, whoever in it created them. */
  | { kind: 'domain'; domainId: string }
  /**
   * A user with no COE assigned yet. Falls back to their own rows rather
   * than to everything: an unassigned account must never be a wider grant
   * than an assigned one.
   */
  | { kind: 'own'; userId: string }

export function scopeFor(user: AuthUser): Scope {
  if (user.role === 'super_admin') return { kind: 'all' }
  if (user.domain_id) return { kind: 'domain', domainId: user.domain_id }
  return { kind: 'own', userId: user.user_id }
}

/** user_ids belonging to a COE — the seam domain scoping is built on. */
function userIdsInDomain(domainId: string) {
  return db.select({ user_id: users.user_id }).from(users).where(eq(users.domain_id, domainId))
}

/** Restricts a products query to what `scope` may see. `undefined` means unrestricted. */
export function productScope(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case 'all':
      return undefined
    case 'domain':
      return inArray(products.user_id, userIdsInDomain(scope.domainId))
    case 'own':
      return eq(products.user_id, scope.userId)
  }
}

/** Restricts a purchase_invoice query to what `scope` may see. */
export function invoiceScope(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case 'all':
      return undefined
    case 'domain':
      return inArray(purchase_invoice.user_id, userIdsInDomain(scope.domainId))
    case 'own':
      return eq(purchase_invoice.user_id, scope.userId)
  }
}

/** Restricts a lending_order query to what `scope` may see. */
export function lendingScope(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case 'all':
      return undefined
    case 'domain':
      return eq(lending_order.domain_id, scope.domainId)
    case 'own':
      return eq(lending_order.issued_by_user_id, scope.userId)
  }
}

// ── Authentication ───────────────────────────────────────────────────────

export type AuthResult =
  | { status: 'ok'; user: AuthUser }
  | { status: 'unauthenticated' }
  | { status: 'csrf' }
  /**
   * The database could not be reached, so we cannot say whether this token is
   * still valid. Distinct from 'unauthenticated' on purpose: this used to
   * collapse into a 401, which the client's authFetch reads as a sign-out —
   * so a brief DB blip logged every user out. It's a 503 now.
   */
  | { status: 'unavailable' }

// Constant-time comparison. The double-submit token makes a timing oracle
// here unlikely to be practical, but there is no reason to leave `===`.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function csrfPassed(req: NextRequest): boolean {
  if (!MUTATING_METHODS.has(req.method)) return true
  const cookie = req.cookies.get('csrf_token')?.value
  const header = req.headers.get('x-csrf-token')
  return !!cookie && !!header && safeEqual(cookie, header)
}

export async function authenticate(req: NextRequest): Promise<AuthResult> {
  // Token first, then CSRF, then the database lookup.
  //
  // Order matters for the status code the caller sees: checking CSRF first
  // meant an entirely unauthenticated request to a mutating route came back
  // 403 CSRF_FAILED, which reads as "you're signed in but something's wrong"
  // rather than "you're not signed in". Both still reject, and the token
  // checks are pure crypto — no database round trip happens until both pass,
  // so a flood of CSRF failures still costs nothing at the database.
  const token = req.cookies.get('access_token')?.value
  if (!token) return { status: 'unauthenticated' }

  const claims = await verifyAccessToken(token)
  if (!claims) return { status: 'unauthenticated' }

  if (!csrfPassed(req)) return { status: 'csrf' }

  try {
    const [row] = await db
      .select({
        user_id: users.user_id,
        email: users.email,
        full_name: users.full_name,
        role: users.role,
        is_active: users.is_active,
        domain_id: users.domain_id,
      })
      .from(users)
      .where(eq(users.user_id, claims.sub))

    // The token is signed, but role and is_active are re-read from the
    // database on every request — so deactivating an account or changing its
    // role takes effect immediately, not at the next token expiry.
    if (!row || !row.is_active) return { status: 'unauthenticated' }
    return { status: 'ok', user: row as AuthUser }
  } catch (error) {
    logger.error('Auth lookup failed', { requestId: requestIdFrom(req), route: req.nextUrl.pathname }, error)
    return { status: 'unavailable' }
  }
}

// ── Route guard ──────────────────────────────────────────────────────────

export type Authorized = { ok: true; user: AuthUser; scope: Scope }
export type Denied = { ok: false; response: NextResponse }

function deny(status: number, code: string, message: string): Denied {
  return { ok: false, response: NextResponse.json({ success: false, error: { code, message } }, { status }) }
}

/**
 * The one entry point every route uses:
 *
 *   const auth = await requireUser(req)
 *   if (!auth.ok) return auth.response
 *   const { user, scope } = auth
 *
 * Pass `{ role: 'super_admin' }` for admin-only routes.
 */
export async function requireUser(
  req: NextRequest,
  opts: { role?: 'super_admin' } = {},
): Promise<Authorized | Denied> {
  // Rate limiting lives here rather than in Edge middleware: the in-process
  // counter store needs module state to survive between requests, which the
  // Edge runtime does not guarantee (and demonstrably does not provide — the
  // limit never fired when it was implemented there). Every API route funnels
  // through requireUser, so this is the equivalent chokepoint in the Node
  // runtime. /api/auth/login is the exception and limits itself.
  const limited = await enforceIpRateLimit(req, req.nextUrl.pathname)
  if (limited) return { ok: false, response: limited }

  const result = await authenticate(req)

  switch (result.status) {
    case 'unauthenticated':
      return deny(401, 'UNAUTHORIZED', 'Please sign in to continue')
    case 'csrf':
      // A real 403 now. This used to return 401, which routes then rendered
      // as a sign-out — so an expired CSRF cookie looked like a lost session.
      return deny(403, 'CSRF_FAILED', 'Your session token expired. Please retry.')
    case 'unavailable':
      return deny(503, 'SERVICE_UNAVAILABLE', "We can't reach the database right now. Please try again shortly.")
    case 'ok':
      break
  }

  if (opts.role === 'super_admin' && result.user.role !== 'super_admin') {
    return deny(403, 'FORBIDDEN', 'You do not have permission to do that')
  }

  return { ok: true, user: result.user, scope: scopeFor(result.user) }
}
