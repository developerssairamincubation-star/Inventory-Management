import { NextRequest } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, coe_domains } from '@/db/schema'
import { getAuthUser, unauthorizedResponse, forbiddenResponse } from '@/lib/authMiddleware'
import { ok, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

const PROFILE_COLUMNS = { user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, domain_id: users.domain_id, created_at: users.created_at }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params
    const [row] = await db.select(PROFILE_COLUMNS).from(users).where(eq(users.user_id, id))

    if (!row) throw new ApiError(404, 'NOT_FOUND', 'User not found')
    return ok(row)
  } catch (error) {
    return fromError(error)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params
    const body = await req.json()
    const { full_name, role, is_active, domain_id } = body

    const [target] = await db.select({ role: users.role }).from(users).where(eq(users.user_id, id))
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found')

    if (role === 'user' && target.role === 'super_admin') {
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.role, 'super_admin'))
      if (count <= 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot demote the only super admin')
      }
    }

    if (domain_id) {
      const [domain] = await db.select({ domain_id: coe_domains.domain_id }).from(coe_domains).where(eq(coe_domains.domain_id, domain_id))
      if (!domain) throw new ApiError(400, 'VALIDATION_ERROR', 'domain_id does not reference an existing COE domain')
    }

    const updateData: Partial<typeof users.$inferInsert> = {}
    if (full_name !== undefined) updateData.full_name = full_name
    if (role !== undefined) updateData.role = role
    if (is_active !== undefined) updateData.is_active = is_active
    if (domain_id !== undefined) updateData.domain_id = domain_id || null

    const [updated] = await db.update(users).set(updateData).where(eq(users.user_id, id)).returning(PROFILE_COLUMNS)

    return ok(updated)
  } catch (error) {
    return fromError(error)
  }
}
