import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || 'monthly'

    // Calculate date range based on period
    const now = new Date()
    const startDate = new Date()
    switch (period.toLowerCase()) {
      case 'daily':   startDate.setDate(now.getDate() - 1); break
      case 'weekly':  startDate.setDate(now.getDate() - 7); break
      case 'monthly': startDate.setMonth(now.getMonth() - 1); break
      case 'yearly':  startDate.setFullYear(now.getFullYear() - 1); break
    }

    // Fetch lending orders within the date range to get relevant order IDs
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('lending_order')
      .select('lending_order_id')
      .gte('created_at', startDate.toISOString())

    if (ordersError) {
      console.error('Error fetching lending orders:', ordersError)
      return NextResponse.json({ error: ordersError.message }, { status: 500 })
    }

    const orderIds = (orders || []).map((o: any) => o.lending_order_id)
    if (orderIds.length === 0) return NextResponse.json([])

    // Fetch lending items for those orders with product info
    const { data: lendingItems, error } = await supabaseAdmin
      .from('lending_item')
      .select(`
        quantity,
        original_quantity,
        product_id,
        products (
          product_name
        )
      `)
      .in('lend_order_id', orderIds)

    if (error) {
      console.error('Error fetching lending items:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Aggregate total lent quantity per product
    const productTotals = new Map<string, { product_name: string; total_lent: number }>()

    lendingItems?.forEach((item: any) => {
      const productId = item.product_id
      const productName = item.products?.product_name || 'Unknown Product'
      // Use original_quantity so returned/damaged/lost items still count toward total lent
      const qty = item.original_quantity ?? item.quantity ?? 0

      if (productTotals.has(productId)) {
        productTotals.get(productId)!.total_lent += qty
      } else {
        productTotals.set(productId, { product_name: productName, total_lent: qty })
      }
    })

    // Sort by total_lent descending and return top results
    const sorted = Array.from(productTotals.entries())
      .map(([product_id, data]) => ({
        product_id,
        product_name: data.product_name,
        total_lent: data.total_lent,
      }))
      .sort((a, b) => b.total_lent - a.total_lent)

    return NextResponse.json(sorted)
  } catch (err: any) {
    console.error('Top lent products API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
