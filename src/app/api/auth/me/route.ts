import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok, fromError } from '@/lib/api/response'
import { db } from '@/db/client'
import { coe_domains } from '@/db/schema'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    // Joined here (rather than a second client-side fetch) so the lending
    // form can auto-fill domain/room from the logged-in user in one round trip.
    let domain: { domain_id: string; domain_name: string; room_name: string } | null = null
    if (user.domain_id) {
      const [row] = await db.select().from(coe_domains).where(eq(coe_domains.domain_id, user.domain_id))
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
    return fromError(error)
  }
}
