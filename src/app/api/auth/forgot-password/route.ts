import { NextRequest } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { ilike } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, password_reset_tokens } from '@/db/schema'
import { sendMail } from '@/lib/mailer'
import { ok, fail, fromError } from '@/lib/api/response'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? '').trim()

    if (!email) {
      return fail(400, 'VALIDATION_ERROR', 'email is required')
    }

    const [user] = await db.select().from(users).where(ilike(users.email, email))

    // Always report success, even if no account matches — don't leak which
    // emails are registered. Matches Firebase's sendPasswordResetEmail
    // behavior, which also never reveals account existence to the caller.
    if (user) {
      const rawToken = randomBytes(32).toString('base64url')
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

      await db.insert(password_reset_tokens).values({ user_id: user.user_id, token_hash: tokenHash, expires_at: expiresAt })

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000'
      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`

      await sendMail(
        user.email,
        'Reset your password',
        `<p>Someone requested a password reset for this account.</p><p><a href="${resetUrl}">Click here to reset your password</a>. This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`
      )
    }

    return ok({ success: true })
  } catch (error) {
    return fromError(error)
  }
}
