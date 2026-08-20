import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { category } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { requireUser } from '@/lib/authz'
import { parseBody, parseUuidParam } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

const CATEGORY_CODE_PATTERN = /^[A-Z]{2,4}$/

const updateCategorySchema = z
  .object({
    category_name: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().toUpperCase().regex(CATEGORY_CODE_PATTERN, 'code must be 2-4 letters').optional(),
  })
  .refine((b) => b.category_name !== undefined || b.code !== undefined, { message: 'Nothing to update' })

// super_admin only — see the note in ../route.ts. A category's code seeds SKU
// generation for every product in it, across every COE.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const body = await parseBody(req, updateCategorySchema)

    const updateData: { category_name?: string; code?: string } = {}
    if (body.category_name !== undefined) updateData.category_name = body.category_name
    if (body.code !== undefined) {
      const [existing] = await db.select({ category_id: category.category_id }).from(category).where(eq(category.code, body.code))
      if (existing && existing.category_id !== id) {
        throw new ApiError(409, 'CONFLICT', 'A category with this code already exists')
      }
      updateData.code = body.code
    }

    const [row] = await db.update(category).set(updateData).where(eq(category.category_id, id)).returning()
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found')

    return ok(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'PUT /api/categories/[id]' })
  }
}
