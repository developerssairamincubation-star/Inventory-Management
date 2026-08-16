import { NextRequest } from 'next/server'
import { eq, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { coe_domains, users, lending_order } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { forbiddenResponse, getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

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
    const domain_name = (body?.domain_name ?? '').trim()
    const room_name = (body?.room_name ?? '').trim()

    if (!domain_name || !room_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'domain_name and room_name are required')
    }

    const [existing] = await db
      .select({ domain_id: coe_domains.domain_id })
      .from(coe_domains)
      .where(or(eq(coe_domains.domain_name, domain_name), eq(coe_domains.room_name, room_name)))

    if (existing && existing.domain_id !== id) {
      throw new ApiError(409, 'CONFLICT', 'A COE domain with this name or room already exists')
    }

    const [row] = await db
      .update(coe_domains)
      .set({ domain_name, room_name })
      .where(eq(coe_domains.domain_id, id))
      .returning()

    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', 'COE domain not found')
    }

    return ok(row)
  } catch (error) {
    return fromError(error)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params

    const [referencingUser] = await db
      .select({ user_id: users.user_id })
      .from(users)
      .where(eq(users.domain_id, id))
      .limit(1)
    if (referencingUser) {
      throw new ApiError(409, 'CONFLICT', 'This COE domain still has users assigned to it — reassign them first')
    }

    const [referencingOrder] = await db
      .select({ lending_order_id: lending_order.lending_order_id })
      .from(lending_order)
      .where(eq(lending_order.domain_id, id))
      .limit(1)
    if (referencingOrder) {
      throw new ApiError(409, 'CONFLICT', 'This COE domain has lending history and cannot be deleted')
    }

    const [row] = await db
      .delete(coe_domains)
      .where(eq(coe_domains.domain_id, id))
      .returning({ domain_id: coe_domains.domain_id })

    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', 'COE domain not found')
    }

    return ok({ success: true })
  } catch (error) {
    return fromError(error)
  }
}
