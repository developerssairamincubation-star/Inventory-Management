import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import getSupabaseAdmin from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    // 1. Get total unique products count
    const { count: totalProducts, error: productsError } = await supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true })

    if (productsError) throw new ApiError(500, 'DATABASE_ERROR', productsError.message)

    // 2. Get total stock quantity (sum of all stock quantities)
    const { data: stocksData, error: quantityError } = await supabaseAdmin
      .from('stocks')
      .select('quantity')

    if (quantityError) throw new ApiError(500, 'DATABASE_ERROR', quantityError.message)

    const totalStockQuantity = stocksData?.reduce((sum, stock) => sum + (stock.quantity || 0), 0) || 0

    // 3. Get low stock products count
    const { data: lowStockData, error: lowStockError } = await supabaseAdmin
      .from('products')
      .select(`
        product_id,
        low_stock_threshold,
        stocks (quantity)
      `)

    if (lowStockError) throw new ApiError(500, 'DATABASE_ERROR', lowStockError.message)

    const lowStockCount = lowStockData?.filter((product: any) => 
      product.low_stock_threshold && 
      product.stocks && 
      product.stocks.quantity <= product.low_stock_threshold
    ).length || 0

    // 4. Get stock status distribution
    // Get all stocks including damaged_quantity and lost_quantity
    const { data: allStocksData, error: allStocksError } = await supabaseAdmin
      .from('stocks')
      .select('quantity, damaged_quantity, lost_quantity')

    if (allStocksError) throw new ApiError(500, 'DATABASE_ERROR', allStocksError.message)

    const damagedQuantity = allStocksData?.reduce((sum, stock) => sum + (stock.damaged_quantity || 0), 0) || 0
    const lostQuantity = allStocksData?.reduce((sum, stock) => sum + (stock.lost_quantity || 0), 0) || 0

    // Calculate lent items (PENDING status = actively lent)
    const { data: lendingData, error: lendingError } = await supabaseAdmin
      .from('lending_item')
      .select(`
        quantity,
        lending_order:lending_order!lend_order_id(status)
      `)

    if (lendingError) throw new ApiError(500, 'DATABASE_ERROR', lendingError.message)

    // Count items that are currently lent out (still outstanding)
    const ACTIVE_LENDING_STATUSES = ['PENDING', 'ACTIVE', 'OVERDUE', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST']
    const lentQuantity = lendingData?.filter((item: any) =>
      ACTIVE_LENDING_STATUSES.includes(item.lending_order?.status)
    ).reduce((sum, item) => sum + (item.quantity || 0), 0) || 0

    // Available = total stock quantity (already reduced by lent & damaged)
    const availableQuantity = totalStockQuantity

    const stockDistribution = {
      lent: lentQuantity,
      available: availableQuantity,
      lostDamaged: damagedQuantity,
      lost: lostQuantity,
      total: totalStockQuantity + lentQuantity + damagedQuantity + lostQuantity
    }

    const grandTotal = stockDistribution.total || 1

    // Calculate percentages
    const stockDistributionPercentages = {
      lent: Math.round((lentQuantity / grandTotal) * 100),
      available: Math.round((availableQuantity / grandTotal) * 100),
      lostDamaged: Math.round((damagedQuantity / grandTotal) * 100),
      lost: Math.round((lostQuantity / grandTotal) * 100),
    }

    return ok({
      totalProducts: totalProducts || 0,
      totalStockQuantity,
      lowStockCount,
      stockDistribution,
      stockDistributionPercentages
    })
  } catch (error) {
    return fromError(error)
  }
}
