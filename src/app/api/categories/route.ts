import { NextRequest } from 'next/server'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { category } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, created, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const rows = await db.select().from(category).orderBy(asc(category.category_name))
    return ok(rows)
  } catch (error) {
    console.warn('Category list warning:', error instanceof Error ? error.message : error)
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

    const [row] = await db.insert(category).values({ category_name }).returning()
    return created(row)
  } catch (error) {
    return fromError(error)
  }
}
