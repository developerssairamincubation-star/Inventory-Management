import { NextRequest } from 'next/server'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { hashPassword } from '@/lib/passwords'
import { getAuthUser, unauthorizedResponse, forbiddenResponse } from '@/lib/authMiddleware'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const rows = await db
      .select({ user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, created_at: users.created_at })
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
    const { email, full_name, password, role = 'user' } = body

    if (!email || !full_name || !password) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'email, full_name, and password are required')
    }
    if (!['super_admin', 'user'].includes(role)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'role must be super_admin or user')
    }

    const password_hash = await hashPassword(password)

    const [newUser] = await db
      .insert(users)
      .values({ email, full_name, role, is_active: true, password_hash })
      .returning({ user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, created_at: users.created_at })

    return created(newUser)
  } catch (error) {
    return fromError(error)
  }
}
