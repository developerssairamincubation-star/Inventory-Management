import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    // 1. Get total unique products count
    const { count: totalProducts, error: productsError } = await supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true })

    if (productsError) throw productsError

    // 2. Get total stock quantity (sum of all stock quantities)
    const { data: stocksData, error: quantityError } = await supabaseAdmin
      .from('stocks')
      .select('quantity')

    if (quantityError) throw quantityError

    const totalStockQuantity = stocksData?.reduce((sum, stock) => sum + (stock.quantity || 0), 0) || 0

    // 3. Get low stock products count
    const { data: lowStockData, error: lowStockError } = await supabaseAdmin
      .from('products')
      .select(`
        product_id,
        low_stock_threshold,
        stocks (quantity)
      `)

    if (lowStockError) throw lowStockError

    const lowStockCount = lowStockData?.filter((product: any) => 
      product.low_stock_threshold && 
      product.stocks && 
      product.stocks.quantity <= product.low_stock_threshold
    ).length || 0

    // 4. Get stock status distribution
    // Calculate lent items
    const { data: lendingData, error: lendingError } = await supabaseAdmin
      .from('lending_item')
      .select(`
        quantity,
        lending_order:lending_order!lend_order_id(status)
      `)

    if (lendingError) throw lendingError

    // Count items that are currently lent (status = 'ACTIVE' or 'OVERDUE')
    const lentQuantity = lendingData?.filter((item: any) => 
      item.lending_order?.status === 'ACTIVE' || item.lending_order?.status === 'OVERDUE'
    ).reduce((sum, item) => sum + (item.quantity || 0), 0) || 0

    // Get available stock (total - lent)
    const availableQuantity = totalStockQuantity - lentQuantity

    // For now, we'll set lost/damaged to 0 since we don't have this data yet
    // This can be calculated from a separate table or field if available
    const lostDamagedQuantity = 0

    const stockDistribution = {
      lent: lentQuantity,
      available: availableQuantity,
      lostDamaged: lostDamagedQuantity,
      total: totalStockQuantity
    }

    // Calculate percentages
    const stockDistributionPercentages = {
      lent: totalStockQuantity > 0 ? Math.round((lentQuantity / totalStockQuantity) * 100) : 0,
      available: totalStockQuantity > 0 ? Math.round((availableQuantity / totalStockQuantity) * 100) : 0,
      lostDamaged: totalStockQuantity > 0 ? Math.round((lostDamagedQuantity / totalStockQuantity) * 100) : 0,
    }

    return NextResponse.json({
      totalProducts: totalProducts || 0,
      totalStockQuantity,
      lowStockCount,
      stockDistribution,
      stockDistributionPercentages
    })
  } catch (err: any) {
    console.error('Dashboard stats error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
