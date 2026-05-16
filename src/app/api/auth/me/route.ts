import { NextRequest } from 'next/server'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok } from '@/lib/api/response'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  return ok({
    user_id:   user.user_id,
    email:     user.email,
    full_name: user.full_name,
    role:      user.role,
  })
}
