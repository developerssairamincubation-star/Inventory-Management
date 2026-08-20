import { NextRequest } from 'next/server'
import { asc, eq, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { coe_domains } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { created, fromError, ok } from '@/lib/api/response'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'
import { parseBody } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

const domainSchema = z.object({
  domain_name: z.string().trim().min(1).max(150),
  room_name: z.string().trim().min(1).max(150),
})

// GET is open to any authenticated user — the lending page's domain/room
// picker (for a super_admin issuing on behalf of a COE) needs this list too.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  try {
    const rows = await db
      .select()
      .from(coe_domains)
      .orderBy(asc(coe_domains.domain_name))

    return ok(rows)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), route: 'GET /api/coe-domains' })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const { domain_name, room_name } = await parseBody(req, domainSchema)

    const [existing] = await db
      .select({ domain_id: coe_domains.domain_id })
      .from(coe_domains)
      .where(or(eq(coe_domains.domain_name, domain_name), eq(coe_domains.room_name, room_name)))

    if (existing) {
      throw new ApiError(409, 'CONFLICT', 'A COE domain with this name or room already exists')
    }

    const [row] = await db.insert(coe_domains).values({ domain_name, room_name }).returning()

    return created(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), route: 'POST /api/coe-domains' })
  }
}
