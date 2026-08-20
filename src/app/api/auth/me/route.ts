import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireUser } from '@/lib/authz'
import { ok, fromError } from '@/lib/api/response'
import { db } from '@/db/client'
import { coe_domains } from '@/db/schema'
import { requestIdFrom } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { user } = auth

  try {
    // Joined here (rather than a second client-side fetch) so the lending
    // form can auto-fill domain/room from the logged-in user in one round trip.
    let domain: { domain_id: string; domain_name: string; room_name: string } | null = null
    if (user.domain_id) {
      const [row] = await db
        .select({ domain_id: coe_domains.domain_id, domain_name: coe_domains.domain_name, room_name: coe_domains.room_name })
        .from(coe_domains)
        .where(eq(coe_domains.domain_id, user.domain_id))
      domain = row ?? null
    }

    return ok({
      user_id:   user.user_id,
      email:     user.email,
      full_name: user.full_name,
      role:      user.role,
      domain,
    })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: user.user_id, route: 'GET /api/auth/me' })
  }
}
