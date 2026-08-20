import { NextRequest } from 'next/server'
import { eq, sql, and, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { users, coe_domains } from '@/db/schema'
import { requireUser } from '@/lib/authz'
import { revokeAllSessionsForUser } from '@/lib/sessions'
import { ok, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { parseBody, parseUuidParam, userRole, uuid } from '@/lib/validation'
import { logger, requestIdFrom } from '@/lib/logger'

const PROFILE_COLUMNS = { user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, domain_id: users.domain_id, created_at: users.created_at }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const [row] = await db.select(PROFILE_COLUMNS).from(users).where(eq(users.user_id, id))

    if (!row) throw new ApiError(404, 'NOT_FOUND', 'User not found')
    return ok(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'GET /api/admin/users/[id]' })
  }
}

const updateUserSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).optional(),
    role: userRole.optional(),
    is_active: z.boolean().optional(),
    domain_id: uuid.nullish(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to update' })

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response
  const { user: actor } = auth

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const body = await parseBody(req, updateUserSchema)

    const updated = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: users.role, is_active: users.is_active })
        .from(users)
        .where(eq(users.user_id, id))
        .for('update')
      if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found')

      // Lockout guards. The old code only blocked demoting the last
      // super_admin — deactivating them was permitted, which locks every
      // admin function in the app with no way back in through the UI.
      const losingAdmin =
        target.role === 'super_admin' && (body.role === 'user' || body.is_active === false)

      if (losingAdmin) {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.role, 'super_admin'), eq(users.is_active, true), ne(users.user_id, id)))
        if (count < 1) {
          throw new ApiError(
            400,
            'LAST_SUPER_ADMIN',
            'This is the only active super admin. Promote another account first.',
          )
        }
      }

      // Self-lockout guard: an admin removing their own access mid-session
      // has no way to undo it.
      if (id === actor.user_id && (body.role === 'user' || body.is_active === false)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'You cannot remove your own admin access. Ask another super admin.')
      }

      if (body.domain_id) {
        const [domain] = await tx.select({ domain_id: coe_domains.domain_id }).from(coe_domains).where(eq(coe_domains.domain_id, body.domain_id))
        if (!domain) throw new ApiError(400, 'VALIDATION_ERROR', 'domain_id does not reference an existing COE domain')
      }

      const updateData: Partial<typeof users.$inferInsert> = {}
      if (body.full_name !== undefined) updateData.full_name = body.full_name
      if (body.role !== undefined) updateData.role = body.role
      if (body.is_active !== undefined) updateData.is_active = body.is_active
      if (body.domain_id !== undefined) updateData.domain_id = body.domain_id || null

      const [row] = await tx.update(users).set(updateData).where(eq(users.user_id, id)).returning(PROFILE_COLUMNS)

      // Deactivating or demoting must end the account's live sessions.
      // requireUser re-reads is_active and role on every request so API access
      // stops immediately either way, but leaving valid refresh tokens
      // outstanding for a disabled account serves no purpose.
      if (body.is_active === false || (body.role !== undefined && body.role !== target.role)) {
        await revokeAllSessionsForUser(tx, id)
      }

      return row
    })

    logger.info('User account updated', {
      requestId: requestIdFrom(req),
      userId: actor.user_id,
      targetUserId: id,
      changes: Object.keys(body),
    })

    return ok(updated)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: actor.user_id, route: 'PUT /api/admin/users/[id]' })
  }
}
