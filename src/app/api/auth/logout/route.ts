import { NextRequest } from 'next/server'
import { db } from '@/db/client'
import { revokeSession } from '@/lib/sessions'
import { clearAuthCookies } from '@/lib/cookies'
import { ok, fromError } from '@/lib/api/response'
import { logger, requestIdFrom } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req)

  try {
    const refreshToken = req.cookies.get('refresh_token')?.value
    if (refreshToken) {
      await revokeSession(db, refreshToken)
    }

    logger.info('Logout', { requestId })

    const res = ok({ success: true })
    clearAuthCookies(res)
    return res
  } catch (error) {
    // Even if revoking the stored session fails, the cookies must go — a
    // user who clicked "log out" should never stay signed in on this device
    // because of a database hiccup.
    logger.error('Logout failed to revoke the session; clearing cookies anyway', { requestId }, error)
    const res = fromError(error, { requestId, route: 'POST /api/auth/logout' })
    clearAuthCookies(res)
    return res
  }
}
