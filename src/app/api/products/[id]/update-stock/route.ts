import { NextRequest } from 'next/server'
import { and, eq, getTableColumns } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { products, stocks } from '@/db/schema'
import { requireUser, productScope } from '@/lib/authz'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { adjustStock, setStock, actorFrom } from '@/lib/stock'
import { parseBody, parseUuidParam, money, nonNegativeQuantity } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

const updateStockSchema = z
  .object({
    // Relative top-up.
    additionalStock: nonNegativeQuantity.optional(),
    // Absolute stocktake correction.
    newStock: nonNegativeQuantity.optional(),
    unitCost: money.optional(),
    location: z.string().trim().max(50).nullish(),
  })
  .refine((b) => !(b.additionalStock !== undefined && b.newStock !== undefined), {
    message: 'Send either additionalStock or newStock, not both',
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Nothing to update',
  })

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { user, scope } = auth
  const actor = actorFrom(user, requestIdFrom(request))

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const body = await parseBody(request, updateStockSchema)

    // Everything now runs in one transaction. The stocks update and the
    // products update used to be two independent statements with no
    // transaction at all, so a failure between them left the quantity changed
    // and the unit cost not — or vice versa.
    const updated = await db.transaction(async (tx) => {
      const visible = productScope(scope)
      const [owned] = await tx
        .select({ product_id: products.product_id })
        .from(products)
        .where(visible ? and(eq(products.product_id, id), visible) : eq(products.product_id, id))
      if (!owned) throw new ApiError(404, 'NOT_FOUND', 'Product not found')

      // Both paths go through the locking helpers rather than the old
      // read-then-write, which let two concurrent restocks read the same
      // quantity and each overwrite the other's result.
      if (body.newStock !== undefined) {
        await setStock(tx, { productId: id, quantity: body.newStock, actor, note: 'Stock corrected from the product page' })
      } else if (body.additionalStock !== undefined && body.additionalStock > 0) {
        await adjustStock(tx, {
          productId: id,
          delta: body.additionalStock,
          reason: 'MANUAL_ADJUSTMENT',
          actor,
          note: 'Manual top-up from the product page',
          createIfMissing: true,
        })
      }

      if (body.location !== undefined) {
        await tx.update(stocks).set({ location: body.location ?? null }).where(eq(stocks.product_id, id))
      }

      if (body.unitCost !== undefined) {
        await tx.update(products).set({ unit_cost: String(body.unitCost) }).where(eq(products.product_id, id))
      }

      const [row] = await tx
        .select({ ...getTableColumns(products), stocks: { quantity: stocks.quantity, location: stocks.location } })
        .from(products)
        .leftJoin(stocks, eq(stocks.product_id, products.product_id))
        .where(eq(products.product_id, id))

      return row
    })

    return ok({ success: true, product: updated })
  } catch (error) {
    return fromError(error, {
      requestId: requestIdFrom(request),
      userId: user.user_id,
      route: 'PATCH /api/products/[id]/update-stock',
    })
  }
}
