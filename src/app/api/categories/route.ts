import { NextRequest } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { category } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, created, ok } from '@/lib/api/response'
import { requireUser } from '@/lib/authz'
import { suggestCategoryCode } from '@/lib/categoryCode'
import { parseBody } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const CATEGORY_CODE_PATTERN = /^[A-Z]{2,4}$/

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  try {
    const rows = await db.select().from(category).orderBy(asc(category.category_name))
    return ok(rows)
  } catch (error) {
    // This used to swallow the error and return `ok([])` with a 200. A
    // database outage was therefore indistinguishable from "you have no
    // categories" — operators would start creating duplicates — and because
    // nothing was reported, the outage was invisible in Sentry as well.
    // Failing loudly is the correct fallback here.
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'GET /api/categories' })
  }
}

const createCategorySchema = z.object({
  category_name: z.string().trim().min(1).max(200),
  code: z.string().trim().toUpperCase().regex(CATEGORY_CODE_PATTERN, 'code must be 2-4 letters').optional(),
})

// Categories are global reference data whose `code` seeds SKU generation for
// every product in them, so writes are super_admin-only — matching
// departments and coe_domains, which were already gated. Any signed-in user
// could previously rename or re-code any category, and because
// allocateNextSkuCode rewrites `prefix` on every call, a re-code silently
// re-pointed SKU generation for every future product in that category across
// every COE.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const body = await parseBody(req, createCategorySchema)

    let code: string
    if (body.code) {
      code = body.code
      const [existing] = await db.select({ category_id: category.category_id }).from(category).where(eq(category.code, code))
      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'A category with this code already exists')
      }
    } else {
      code = await suggestCategoryCode(db, body.category_name)
    }

    const [row] = await db.insert(category).values({ category_name: body.category_name, code }).returning()
    return created(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'POST /api/categories' })
  }
}
