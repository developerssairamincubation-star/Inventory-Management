import { requireUser, lendingScope, productScope } from '@/lib/authz'
import { requestIdFrom } from '@/lib/logger'
import { NextRequest } from 'next/server'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks, lending_order, lending_item } from '@/db/schema'
import { fromError, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { user, scope } = auth

  try {

    // Scoped to the caller's COE, not to what they personally created.
    const userProducts = await db
      .select({ product_id: products.product_id })
      .from(products)
      .where(productScope(scope))

    const totalProducts = userProducts.length
    const productIds = userProducts.map((p) => p.product_id)

    const stocksData = productIds.length
      ? await db.select({ product_id: stocks.product_id, quantity: stocks.quantity, damaged_quantity: stocks.damaged_quantity, lost_quantity: stocks.lost_quantity }).from(stocks).where(inArray(stocks.product_id, productIds))
      : []

    const totalStockQuantity = stocksData.reduce((sum, s) => sum + (s.quantity || 0), 0)
    const damagedQuantity = stocksData.reduce((sum, s) => sum + (s.damaged_quantity || 0), 0)
    const lostQuantity = stocksData.reduce((sum, s) => sum + (s.lost_quantity || 0), 0)

    const userOrders = await db
      .select({ lending_order_id: lending_order.lending_order_id, status: lending_order.status })
      .from(lending_order)
      .where(lendingScope(scope))

    const userOrderIds = userOrders.map((o) => o.lending_order_id)

    let lentQuantity = 0
    if (userOrderIds.length > 0) {
      const lendingData = await db.select({ quantity: lending_item.quantity, lend_order_id: lending_item.lend_order_id }).from(lending_item).where(inArray(lending_item.lend_order_id, userOrderIds))

      // Note: 'ACTIVE' was previously included here but doesn't exist in the
      // lending_order_status enum — dead/no-op filter value, removed.
      const ACTIVE_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST']
      const activeOrderIds = new Set(userOrders.filter((o) => ACTIVE_STATUSES.includes(o.status)).map((o) => o.lending_order_id))
      lentQuantity = lendingData.filter((item) => activeOrderIds.has(item.lend_order_id)).reduce((sum, item) => sum + (item.quantity || 0), 0)
    }

    // `available` is what's on the shelf and `lent` is what's out on loan;
    // damaged and lost units left the shelf when they were issued and are
    // tracked separately, so the four are disjoint and sum to everything the
    // COE has ever held.
    const stockDistribution = {
      lent: lentQuantity,
      available: totalStockQuantity,
      lostDamaged: damagedQuantity,
      lost: lostQuantity,
      total: totalStockQuantity + lentQuantity + damagedQuantity + lostQuantity,
    }

    const grandTotal = stockDistribution.total || 1
    const stockDistributionPercentages = {
      lent: Math.round((lentQuantity / grandTotal) * 100),
      available: Math.round((totalStockQuantity / grandTotal) * 100),
      lostDamaged: Math.round((damagedQuantity / grandTotal) * 100),
      lost: Math.round((lostQuantity / grandTotal) * 100),
    }

    return ok({ totalProducts, totalStockQuantity, stockDistribution, stockDistributionPercentages })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: user.user_id, route: 'GET /api/dashboard/stats' })
  }
}
