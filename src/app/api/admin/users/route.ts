import { NextRequest } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, coe_domains } from '@/db/schema'
import { hashPassword } from '@/lib/passwords'
import { getAuthUser, unauthorizedResponse, forbiddenResponse } from '@/lib/authMiddleware'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

const USER_COLUMNS = { user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, domain_id: users.domain_id, created_at: users.created_at }

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const rows = await db
      .select(USER_COLUMNS)
      .from(users)
      .orderBy(asc(users.created_at))

    return ok(rows)
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const body = await req.json()
    const { email, full_name, password, role = 'user', domain_id = null } = body

    if (!email || !full_name || !password) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'email, full_name, and password are required')
    }
    if (!['super_admin', 'user'].includes(role)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'role must be super_admin or user')
    }
    if (domain_id) {
      const [domain] = await db.select({ domain_id: coe_domains.domain_id }).from(coe_domains).where(eq(coe_domains.domain_id, domain_id))
      if (!domain) throw new ApiError(400, 'VALIDATION_ERROR', 'domain_id does not reference an existing COE domain')
    }

    const password_hash = await hashPassword(password)

    const [newUser] = await db
      .insert(users)
      .values({ email, full_name, role, is_active: true, password_hash, domain_id: domain_id || null })
      .returning(USER_COLUMNS)

    return created(newUser)
  } catch (error) {
    return fromError(error)
  }
}
