import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { signAccessToken } from '@/lib/jwt'
import { rotateSession } from '@/lib/sessions'
import { setAuthCookies, clearAuthCookies } from '@/lib/cookies'

function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh_token')?.value

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 })
  }

  const result = await rotateSession(db, refreshToken, { userAgent: req.headers.get('user-agent'), ipAddress: clientIp(req) })

  if (result.status !== 'rotated') {
    // Covers both "invalid/expired" and "reused" (theft signal, session
    // already fully revoked by rotateSession) — either way the client must
    // re-authenticate.
    const res = NextResponse.json({ error: 'Session expired, please log in again' }, { status: 401 })
    clearAuthCookies(res)
    return res
  }

  const [user] = await db.select().from(users).where(eq(users.user_id, result.userId))
  if (!user || !user.is_active) {
    const res = NextResponse.json({ error: 'Account no longer active' }, { status: 401 })
    clearAuthCookies(res)
    return res
  }

  const accessToken = await signAccessToken({ sub: user.user_id, email: user.email, role: user.role })
  const csrfToken = randomBytes(24).toString('base64url')

  const res = NextResponse.json({ success: true })
  setAuthCookies(res, { accessToken, refreshToken: result.rawToken, csrfToken })
  return res
}
