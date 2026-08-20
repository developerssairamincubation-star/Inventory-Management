import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { ilike } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { verifyPassword, hashPassword } from '@/lib/passwords'
import { signAccessToken } from '@/lib/jwt'
import { createSession } from '@/lib/sessions'
import { setAuthCookies } from '@/lib/cookies'
import { fail, fromError, ok } from '@/lib/api/response'
import { rateLimit, RULES, clientIp, enforceIpRateLimit } from '@/lib/rateLimit'
import { logger, requestIdFrom } from '@/lib/logger'

// A bcrypt hash of a value nobody knows, compared against when the email is
// unknown so the response takes the same ~250ms as a real attempt. Without
// this, an unknown email returned in milliseconds while a known one paid for
// a full bcrypt round — a reliable user-enumeration oracle even though the
// response bodies were identical. Computed lazily on first miss so startup
// doesn't pay for it.
let dummyHash: string | null = null
async function equivalentWork(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword(randomBytes(32).toString('hex'))
  await verifyPassword(password, dummyHash)
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req)
  const ip = clientIp(req)

  // Login doesn't go through requireUser, so it applies the per-IP limit
  // itself — and a per-account limit below. One without the other is
  // incomplete: per-IP alone lets a distributed attack spray one account,
  // per-account alone lets one host walk the whole user list.
  const limited = await enforceIpRateLimit(req, '/api/auth/login')
  if (limited) return limited

  try {
    const body = await req.json().catch(() => null)
    const email = String((body as { email?: unknown } | null)?.email ?? '').trim()
    const password = String((body as { password?: unknown } | null)?.password ?? '')

    if (!email || !password) {
      return fail(400, 'VALIDATION_ERROR', 'email and password are required')
    }

    // Per-account limit, alongside the per-IP limit the middleware already
    // applied. One without the other is incomplete: per-IP alone lets a
    // distributed attack spray one account, and per-account alone lets one
    // host walk the whole user list.
    const accountLimit = await rateLimit(`login:account:${email.toLowerCase()}`, RULES.loginPerAccount)
    if (!accountLimit.allowed) {
      logger.warn('Login blocked by per-account rate limit', { requestId, ip, email })
      return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts for this account. Please wait a few minutes.')
    }

    // Case-insensitive lookup: matches the usual "email login is not
    // case-sensitive" UX every mainstream auth provider implements.
    const [user] = await db.select().from(users).where(ilike(users.email, email))

    if (!user) {
      await equivalentWork(password)
      logger.warn('Failed login: unknown account', { requestId, ip, email })
      return fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      logger.warn('Failed login: wrong password', { requestId, ip, email, userId: user.user_id })
      return fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    }

    // Same 401 and same message as a wrong password. A distinct 403
    // ACCOUNT_DISABLED confirmed to an attacker that the address is a real
    // account, which is exactly what the identical-response rule above is
    // meant to withhold.
    if (!user.is_active) {
      logger.warn('Failed login: account disabled', { requestId, ip, userId: user.user_id })
      return fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    }

    const accessToken = await signAccessToken({ sub: user.user_id, email: user.email, role: user.role })
    const session = await createSession(db, user.user_id, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: ip === 'unknown' ? null : ip,
    })
    const csrfToken = randomBytes(24).toString('base64url')

    logger.info('Login succeeded', { requestId, ip, userId: user.user_id, role: user.role })

    const res = ok({ user_id: user.user_id, email: user.email, full_name: user.full_name, role: user.role })
    setAuthCookies(res, { accessToken, refreshToken: session.rawToken, csrfToken })
    return res
  } catch (error) {
    return fromError(error, { requestId, route: 'POST /api/auth/login' })
  }
}

export const dynamic = 'force-dynamic'
