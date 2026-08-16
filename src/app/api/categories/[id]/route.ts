import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { category } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

const CATEGORY_CODE_PATTERN = /^[A-Z]{2,4}$/

// Lets categories created before the auto-SKU feature shipped (code is
// nullable, see db/migrations/V17) get a code backfilled — used by the
// Admin Settings Categories section as well as any inline edit flow.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await req.json()

    const updateData: { category_name?: string; code?: string } = {}
    if (body.category_name !== undefined) {
      const category_name = String(body.category_name).trim()
      if (!category_name) throw new ApiError(400, 'VALIDATION_ERROR', 'category_name cannot be empty')
      updateData.category_name = category_name
    }
    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase()
      if (!CATEGORY_CODE_PATTERN.test(code)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'code must be 2-4 letters')
      }
      const [existing] = await db.select({ category_id: category.category_id }).from(category).where(eq(category.code, code))
      if (existing && existing.category_id !== id) {
        throw new ApiError(409, 'CONFLICT', 'A category with this code already exists')
      }
      updateData.code = code
    }

    const [row] = await db.update(category).set(updateData).where(eq(category.category_id, id)).returning()
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found')

    return ok(row)
  } catch (error) {
    return fromError(error)
  }
}
