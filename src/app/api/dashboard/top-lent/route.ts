import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || 'monthly'

    const now = new Date()
    const startDate = new Date()
    switch (period.toLowerCase()) {
      case 'daily':   startDate.setDate(now.getDate() - 1); break
      case 'weekly':  startDate.setDate(now.getDate() - 7); break
      case 'monthly': startDate.setMonth(now.getMonth() - 1); break
      case 'yearly':  startDate.setFullYear(now.getFullYear() - 1); break
    }

    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('lending_order')
      .select('lending_order_id')
      .eq('issued_by_user_id', user.user_id)
      .gte('created_at', startDate.toISOString())

    if (ordersError) {
      return NextResponse.json({ error: ordersError.message }, { status: 500 })
    }

    const orderIds = (orders || []).map((o: any) => o.lending_order_id)
    if (orderIds.length === 0) return NextResponse.json([])

    const { data: lendingItems, error } = await supabaseAdmin
      .from('lending_item')
      .select('quantity, original_quantity, product_id, products (product_name)')
      .in('lend_order_id', orderIds)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const productTotals = new Map<string, { product_name: string; total_lent: number }>()

    lendingItems?.forEach((item: any) => {
      const productId = item.product_id
      const productName = item.products?.product_name || 'Unknown Product'
      const qty = item.original_quantity ?? item.quantity ?? 0

      if (productTotals.has(productId)) {
        productTotals.get(productId)!.total_lent += qty
      } else {
        productTotals.set(productId, { product_name: productName, total_lent: qty })
      }
    })

    const sorted = Array.from(productTotals.entries())
      .map(([product_id, data]) => ({ product_id, product_name: data.product_name, total_lent: data.total_lent }))
      .sort((a, b) => b.total_lent - a.total_lent)

    return NextResponse.json(sorted)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
