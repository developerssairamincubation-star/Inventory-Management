import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { signAccessToken } from '@/lib/jwt'
import { rotateSession } from '@/lib/sessions'
import { setAuthCookies, clearAuthCookies } from '@/lib/cookies'
import { fail, fromError, ok } from '@/lib/api/response'
import { clientIp } from '@/lib/rateLimit'
import { logger, requestIdFrom } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req)
  const ip = clientIp(req)

  try {
    const refreshToken = req.cookies.get('refresh_token')?.value

    if (!refreshToken) {
      const res = fail(401, 'NO_REFRESH_TOKEN', 'Please sign in to continue')
      // Clear the page-level session hint too, otherwise middleware keeps
      // letting page requests through for a browser that has no way back in.
      clearAuthCookies(res)
      return res
    }

    const result = await rotateSession(db, refreshToken, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: ip === 'unknown' ? null : ip,
    })

    if (result.status === 'reused') {
      // rotateSession has already revoked every session for this user. This
      // is the refresh-token theft signal and is worth an alert, not just a
      // 401 — it means one token was presented twice.
      logger.error('Refresh token reuse detected; all sessions revoked', {
        requestId,
        ip,
        userId: result.userId,
        securityEvent: 'refresh_token_reuse',
      })
      const res = fail(401, 'SESSION_REVOKED', 'Your session has ended for security reasons. Please sign in again.')
      clearAuthCookies(res)
      return res
    }

    if (result.status !== 'rotated') {
      const res = fail(401, 'SESSION_EXPIRED', 'Session expired, please log in again')
      clearAuthCookies(res)
      return res
    }

    const [user] = await db.select().from(users).where(eq(users.user_id, result.userId))
    if (!user || !user.is_active) {
      const res = fail(401, 'ACCOUNT_INACTIVE', 'Account no longer active')
      clearAuthCookies(res)
      return res
    }

    const accessToken = await signAccessToken({ sub: user.user_id, email: user.email, role: user.role })
    const csrfToken = randomBytes(24).toString('base64url')

    const res = ok({ success: true })
    setAuthCookies(res, { accessToken, refreshToken: result.rawToken, csrfToken })
    return res
  } catch (error) {
    return fromError(error, { requestId, route: 'POST /api/auth/refresh' })
  }
}

export const dynamic = 'force-dynamic'
