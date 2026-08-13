import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { ilike } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { verifyPassword } from '@/lib/passwords'
import { signAccessToken } from '@/lib/jwt'
import { createSession } from '@/lib/sessions'
import { setAuthCookies } from '@/lib/cookies'
import { fail, fromError } from '@/lib/api/response'

function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? '').trim()
    const password = String(body?.password ?? '')

    if (!email || !password) {
      return fail(400, 'VALIDATION_ERROR', 'email and password are required')
    }

    // Case-insensitive lookup: matches the usual "email login is not
    // case-sensitive" UX every mainstream auth provider (including the
    // Firebase Auth this replaces) implements.
    const [user] = await db.select().from(users).where(ilike(users.email, email))

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    }
    if (!user.is_active) {
      return fail(403, 'ACCOUNT_DISABLED', 'This account has been disabled')
    }

    const accessToken = await signAccessToken({ sub: user.user_id, email: user.email, role: user.role })
    const session = await createSession(db, user.user_id, { userAgent: req.headers.get('user-agent'), ipAddress: clientIp(req) })
    const csrfToken = randomBytes(24).toString('base64url')

    const res = NextResponse.json({ user_id: user.user_id, email: user.email, full_name: user.full_name, role: user.role })
    setAuthCookies(res, { accessToken, refreshToken: session.rawToken, csrfToken })
    return res
  } catch (error) {
    return fromError(error)
  }
}
