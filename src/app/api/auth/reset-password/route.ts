import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, password_reset_tokens } from '@/db/schema'
import { hashPassword } from '@/lib/passwords'
import { revokeAllSessionsForUser } from '@/lib/sessions'
import { ok, fail, fromError } from '@/lib/api/response'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const token = String(body?.token ?? '')
    const password = String(body?.password ?? '')

    if (!token || !password) {
      return fail(400, 'VALIDATION_ERROR', 'token and password are required')
    }
    if (password.length < 8) {
      return fail(400, 'VALIDATION_ERROR', 'password must be at least 8 characters')
    }

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const [row] = await db.select().from(password_reset_tokens).where(eq(password_reset_tokens.token_hash, tokenHash))

    if (!row || row.used_at || row.expires_at.getTime() < Date.now()) {
      return fail(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired')
    }

    const password_hash = await hashPassword(password)

    await db.transaction(async (tx) => {
      await tx.update(users).set({ password_hash }).where(eq(users.user_id, row.user_id))
      await tx.update(password_reset_tokens).set({ used_at: new Date() }).where(eq(password_reset_tokens.token_id, row.token_id))
      // Force re-login everywhere after a password change — standard
      // security hygiene for a credential-reset flow.
      await revokeAllSessionsForUser(tx, row.user_id)
    })

    return ok({ success: true })
  } catch (error) {
    return fromError(error)
  }
}
