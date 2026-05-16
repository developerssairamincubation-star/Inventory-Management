import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import getSupabaseAdmin from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabaseAdmin = getSupabaseAdmin()

    // Get user's product IDs first
    const { data: userProducts, error: productsError } = await supabaseAdmin
      .from('products')
      .select('product_id, low_stock_threshold')
      .eq('user_id', user.user_id)

    if (productsError) throw new ApiError(500, 'DATABASE_ERROR', productsError.message)

    const totalProducts = userProducts?.length || 0
    const productIds = userProducts?.map((p: any) => p.product_id) || []

    // Get stocks for user's products
    const { data: stocksData, error: quantityError } = productIds.length > 0
      ? await supabaseAdmin.from('stocks').select('product_id, quantity, damaged_quantity, lost_quantity').in('product_id', productIds)
      : { data: [], error: null }

    if (quantityError) throw new ApiError(500, 'DATABASE_ERROR', quantityError.message)

    const totalStockQuantity = stocksData?.reduce((sum, s) => sum + (s.quantity || 0), 0) || 0
    const damagedQuantity = stocksData?.reduce((sum, s) => sum + (s.damaged_quantity || 0), 0) || 0
    const lostQuantity = stocksData?.reduce((sum, s) => sum + (s.lost_quantity || 0), 0) || 0

    const stockByProduct = new Map<string, number>(
      (stocksData || []).map((s: any) => [s.product_id, s.quantity ?? 0])
    )

    const lowStockCount = (userProducts || []).filter((product: any) =>
      product.low_stock_threshold &&
      (stockByProduct.get(product.product_id) ?? 0) <= product.low_stock_threshold
    ).length

    // Get lending items for user's orders
    const { data: userOrders, error: ordersError } = await supabaseAdmin
      .from('lending_order')
      .select('lending_order_id, status')
      .eq('issued_by_user_id', user.user_id)

    if (ordersError) throw new ApiError(500, 'DATABASE_ERROR', ordersError.message)

    const userOrderIds = (userOrders || []).map((o: any) => o.lending_order_id)

    let lentQuantity = 0
    if (userOrderIds.length > 0) {
      const { data: lendingData } = await supabaseAdmin
        .from('lending_item')
        .select('quantity, lend_order_id')
        .in('lend_order_id', userOrderIds)

      const ACTIVE_STATUSES = ['PENDING', 'ACTIVE', 'OVERDUE', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST']
      const activeOrderIds = new Set(
        (userOrders || []).filter((o: any) => ACTIVE_STATUSES.includes(o.status)).map((o: any) => o.lending_order_id)
      )
      lentQuantity = (lendingData || [])
        .filter((item: any) => activeOrderIds.has(item.lend_order_id))
        .reduce((sum, item) => sum + (item.quantity || 0), 0)
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
