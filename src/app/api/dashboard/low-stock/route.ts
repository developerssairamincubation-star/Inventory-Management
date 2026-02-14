import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    // Fetch products with their stock quantities
    const { data: productsData, error: productsError } = await supabaseAdmin
      .from('products')
      .select(`
        product_id,
        product_name,
        product_code,
        low_stock_threshold,
        stocks (quantity)
      `)
      .not('low_stock_threshold', 'is', null)

    if (productsError) {
      console.error('Error fetching low stock products:', productsError)
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    // Filter products where stock is at or below threshold
    const lowStockProducts = productsData?.filter((product: any) => {
      const currentStock = product.stocks?.quantity ?? 0
      const threshold = product.low_stock_threshold
      return threshold && currentStock <= threshold
    }).map((product: any) => ({
      product_id: product.product_id,
      product_name: product.product_name,
      product_code: product.product_code,
      current_stock: product.stocks?.quantity ?? 0,
      threshold: product.low_stock_threshold
    })) || []

    return NextResponse.json(lowStockProducts)
  } catch (err: any) {
    console.error('Low stock API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
