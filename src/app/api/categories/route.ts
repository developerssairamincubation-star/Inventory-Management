import { NextRequest } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { category } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, created, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { suggestCategoryCode } from '@/lib/categoryCode'

export const dynamic = 'force-dynamic'

const CATEGORY_CODE_PATTERN = /^[A-Z]{2,4}$/

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const rows = await db.select().from(category).orderBy(asc(category.category_name))
    return ok(rows)
  } catch (error) {
    console.error('[GET /api/categories] falling back to empty list:', error)
    return ok([])
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()
    const category_name = body.category_name?.trim()
    if (!category_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'category_name is required')
    }

    let code: string
    if (body.code) {
      code = String(body.code).trim().toUpperCase()
      if (!CATEGORY_CODE_PATTERN.test(code)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'code must be 2-4 letters')
      }
      const [existing] = await db.select({ category_id: category.category_id }).from(category).where(eq(category.code, code))
      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'A category with this code already exists')
      }
    } else {
      code = await suggestCategoryCode(db, category_name)
    }

    const [row] = await db.insert(category).values({ category_name, code }).returning()
    return created(row)
  } catch (error) {
    return fromError(error)
  }
}
