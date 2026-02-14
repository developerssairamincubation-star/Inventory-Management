import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    // Fetch all lending items with product info
    const { data: lendingItems, error } = await supabaseAdmin
      .from('lending_item')
      .select(`
        quantity,
        product_id,
        products (
          product_name
        )
      `)

    if (error) {
      console.error('Error fetching lending items:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Aggregate total lent quantity per product
    const productTotals = new Map<string, { product_name: string; total_lent: number }>()

    lendingItems?.forEach((item: any) => {
      const productId = item.product_id
      const productName = item.products?.product_name || 'Unknown Product'
      const qty = item.quantity || 0

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
