// Shared helper for route tests that stub out authorization.
//
// Route tests mock `requireUser` so each test can name the caller directly
// instead of minting real cookies. That keeps them fast and focused on the
// route's own logic — but it means they prove nothing at all about the auth
// layer itself, which is why src/app/api/auth/authorization.test.ts exercises
// the real stack (cookies, CSRF, is_active, role, and the domain scoping) end
// to end without any of this.

import { NextResponse } from 'next/server'
import { scopeFor, type AuthUser, type Authorized, type Denied } from '@/lib/authz'

export type { AuthUser }

/**
 * Builds the value a mocked `requireUser` should resolve to.
 *
 * Pass a user to authorize them (the scope is derived by the real
 * `scopeFor`, so tests exercise the genuine domain/own/all rules rather than
 * a hand-written stand-in). Pass null for an unauthenticated caller.
 */
export function authResult(user: AuthUser | null): Authorized | Denied {
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Please sign in to continue' } },
        { status: 401 },
      ),
    }
  }
  return { ok: true, user, scope: scopeFor(user) }
}

/** The 403 a role-gated route returns when the caller isn't a super_admin. */
export function forbiddenResult(): Denied {
  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to do that' } },
      { status: 403 },
    ),
  }
}

/**
 * Mirrors the real `requireUser(req, { role })` contract for a mocked caller:
 * an authorized user who fails the role check gets a 403, not a 200. Without
 * this, a mock that always returned `authResult(user)` would let a plain
 * `user` straight through every super_admin-only route in the tests.
 */
export function authResultFor(user: AuthUser | null, opts?: { role?: 'super_admin' }): Authorized | Denied {
  const result = authResult(user)
  if (result.ok && opts?.role === 'super_admin' && result.user.role !== 'super_admin') {
    return forbiddenResult()
  }
  return result
}
