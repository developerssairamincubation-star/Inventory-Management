import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { verifyAccessToken } from '@/lib/jwt'

export type AuthUser = {
  user_id: string
  email: string
  full_name: string
  role: 'super_admin' | 'user'
  is_active: boolean
  domain_id: string | null
}

export type AuthedHandler<T = unknown> = (
  req: NextRequest,
  ctx: { user: AuthUser; params?: T }
) => Promise<NextResponse | Response>

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function getUserFromAccessToken(token: string): Promise<AuthUser | null> {
  const claims = await verifyAccessToken(token)
  if (!claims) return null

  const [row] = await db
    .select({ user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, domain_id: users.domain_id })
    .from(users)
    .where(eq(users.user_id, claims.sub))

  if (!row || !row.is_active) return null
  return row as AuthUser
}

function extractAccessToken(req: NextRequest): string | null {
  return req.cookies.get('access_token')?.value ?? null
}

// Double-submit CSRF check: the client echoes the (non-httpOnly) csrf_token
// cookie back as an X-CSRF-Token header on mutating requests. Every one of
// the app's 28+ routes calls getAuthUser() directly (none use the withAuth
// wrapper below), so this lives here — the single chokepoint every route
// already goes through — rather than only in withAuth, which would leave it
// unenforced everywhere. A CSRF failure surfaces as the same 401 a missing/
// invalid token would (routes only branch on "user present or not"), which
// is a coarser status code than the "correct" 403 but requires no changes
// to any of the existing 28 route files.
function csrfPassed(req: NextRequest): boolean {
  if (!MUTATING_METHODS.has(req.method)) return true
  const cookie = req.cookies.get('csrf_token')?.value
  const header = req.headers.get('x-csrf-token')
  return !!cookie && !!header && cookie === header
}

// Utility: pull the access token from cookies (+ CSRF-check mutating
// requests) and return the user. This is the seam nearly every route calls
// directly as `const user = await getAuthUser(req); if (!user) return
// unauthorizedResponse()`.
export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  if (!csrfPassed(req)) return null
  const token = extractAccessToken(req)
  if (!token) return null
  return getUserFromAccessToken(token)
}

export function withAuth(handler: AuthedHandler): (req: NextRequest) => Promise<NextResponse | Response>
export function withAuth<T>(handler: AuthedHandler<T>, opts?: { params: T }): (req: NextRequest) => Promise<NextResponse | Response>

export function withAuth(handler: AuthedHandler, opts?: { params?: unknown }) {
  return async (req: NextRequest) => {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return handler(req, { user, params: opts?.params })
  }
}

export function withSuperAdmin(handler: AuthedHandler) {
  return withAuth(async (req, ctx) => {
    if (ctx.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return handler(req, ctx)
  })
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
