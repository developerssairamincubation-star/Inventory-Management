import { NextRequest, NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabaseAdmin = getSupabaseAdmin()

    const { data: productsData, error: productsError } = await supabaseAdmin
      .from('products')
      .select('product_id, product_name, product_code, low_stock_threshold, stocks (quantity)')
      .eq('user_id', user.user_id)
      .not('low_stock_threshold', 'is', null)

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    const lowStockProducts = productsData?.filter((product: any) => {
      const currentStock = product.stocks?.quantity ?? 0
      const threshold = product.low_stock_threshold
      return threshold && currentStock <= threshold
    }).map((product: any) => ({
      product_id: product.product_id,
      product_name: product.product_name,
      product_code: product.product_code,
      current_stock: product.stocks?.quantity ?? 0,
      threshold: product.low_stock_threshold,
    })) || []

    return NextResponse.json(lowStockProducts)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
