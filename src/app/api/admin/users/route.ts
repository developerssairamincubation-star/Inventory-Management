import { NextRequest } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { users, coe_domains } from '@/db/schema'
import { hashPassword } from '@/lib/passwords'
import { requireUser } from '@/lib/authz'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { parseBody, password, email, userRole, uuid } from '@/lib/validation'
import { logger, requestIdFrom } from '@/lib/logger'

const USER_COLUMNS = { user_id: users.user_id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, domain_id: users.domain_id, created_at: users.created_at }

export async function GET(req: NextRequest) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const rows = await db.select(USER_COLUMNS).from(users).orderBy(asc(users.created_at))
    return ok(rows)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'GET /api/admin/users' })
  }
}

// The only check here used to be `if (!email || !full_name || !password)`, so
// a super_admin account could be created with the password "a" and an email
// of "notanemail". Combined with the absence of any rate limiting, that made
// weak credentials both permitted and unlimited-guessable.
const createUserSchema = z.object({
  email,
  full_name: z.string().trim().min(1).max(200),
  password,
  role: userRole.default('user'),
  domain_id: uuid.nullish(),
})

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const body = await parseBody(req, createUserSchema)

    if (body.domain_id) {
      const [domain] = await db.select({ domain_id: coe_domains.domain_id }).from(coe_domains).where(eq(coe_domains.domain_id, body.domain_id))
      if (!domain) throw new ApiError(400, 'VALIDATION_ERROR', 'domain_id does not reference an existing COE domain')
    }

    const [existing] = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, body.email))
    if (existing) throw new ApiError(409, 'CONFLICT', 'An account with that email already exists')

    const password_hash = await hashPassword(body.password)

    const [newUser] = await db
      .insert(users)
      .values({
        email: body.email,
        full_name: body.full_name,
        role: body.role,
        is_active: true,
        password_hash,
        domain_id: body.domain_id || null,
      })
      .returning(USER_COLUMNS)

    // Account creation is a security-relevant event and previously left no
    // trace at all — nothing recorded who created which account, or when.
    logger.info('User account created', {
      requestId: requestIdFrom(req),
      userId: auth.user.user_id,
      createdUserId: newUser.user_id,
      createdRole: newUser.role,
    })

    return created(newUser)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'POST /api/admin/users' })
  }
}
