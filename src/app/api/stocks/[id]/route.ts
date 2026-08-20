import { NextRequest } from "next/server";
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { stocks, products } from '@/db/schema'
import { requireUser, productScope } from '@/lib/authz'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { parseUuidParam } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { scope } = auth

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)

    // This route authenticated but never authorized: it looked stock up by
    // product_id with no scope predicate at all, so any signed-in user could
    // read any product's stock level in any COE — and enumerate product ids
    // to aim other requests at.
    const visible = productScope(scope)
    const [row] = await db
      .select({
        quantity: stocks.quantity,
        damaged_quantity: stocks.damaged_quantity,
        lost_quantity: stocks.lost_quantity,
        location: stocks.location,
      })
      .from(stocks)
      .innerJoin(products, eq(products.product_id, stocks.product_id))
      .where(visible ? and(eq(stocks.product_id, id), visible) : eq(stocks.product_id, id))

    // Was a 500 — a missing record is a client-side 404, not a server fault,
    // and reporting it as one buried real failures in the same signal.
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Stock record not found')

    return ok(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: auth.user.user_id, route: 'GET /api/stocks/[id]' })
  }
}
