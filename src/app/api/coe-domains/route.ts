import { NextRequest } from 'next/server'
import { asc, eq, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { coe_domains } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { created, fromError, ok } from '@/lib/api/response'
import { forbiddenResponse, getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

// GET is open to any authenticated user — the lending page's domain/room
// picker (for a super_admin issuing on behalf of a COE) needs this list too.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const rows = await db
      .select()
      .from(coe_domains)
      .orderBy(asc(coe_domains.domain_name))

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
    const domain_name = (body?.domain_name ?? '').trim()
    const room_name = (body?.room_name ?? '').trim()

    if (!domain_name || !room_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'domain_name and room_name are required')
    }

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
    return fromError(error)
  }
}
