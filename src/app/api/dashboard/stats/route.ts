import { NextRequest } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks, lending_order, lending_item } from '@/db/schema'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const userProducts = await db.select({ product_id: products.product_id, low_stock_threshold: products.low_stock_threshold }).from(products).where(eq(products.user_id, user.user_id))

    const totalProducts = userProducts.length
    const productIds = userProducts.map((p) => p.product_id)

    const stocksData = productIds.length
      ? await db.select({ product_id: stocks.product_id, quantity: stocks.quantity, damaged_quantity: stocks.damaged_quantity, lost_quantity: stocks.lost_quantity }).from(stocks).where(inArray(stocks.product_id, productIds))
      : []

    const totalStockQuantity = stocksData.reduce((sum, s) => sum + (s.quantity || 0), 0)
    const damagedQuantity = stocksData.reduce((sum, s) => sum + (s.damaged_quantity || 0), 0)
    const lostQuantity = stocksData.reduce((sum, s) => sum + (s.lost_quantity || 0), 0)

    const stockByProduct = new Map(stocksData.map((s) => [s.product_id, s.quantity ?? 0]))

    const lowStockCount = userProducts.filter((product) =>
      product.low_stock_threshold && (stockByProduct.get(product.product_id) ?? 0) <= product.low_stock_threshold
    ).length

    const userOrders = await db.select({ lending_order_id: lending_order.lending_order_id, status: lending_order.status }).from(lending_order).where(eq(lending_order.issued_by_user_id, user.user_id))

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

    return ok({ totalProducts, totalStockQuantity, lowStockCount, stockDistribution, stockDistributionPercentages })
  } catch (error) {
    return fromError(error)
  }
}
