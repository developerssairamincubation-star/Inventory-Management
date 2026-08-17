import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { lending_order, lending_item, products } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { classifyError } from '@/lib/api/classifyError'

export const dynamic = 'force-dynamic'

function getStartDate(period: string): Date {
  const now = new Date()
  const startDate = new Date()
  switch (period.toLowerCase()) {
    case 'daily': startDate.setDate(now.getDate() - 1); break
    case 'weekly': startDate.setDate(now.getDate() - 7); break
    case 'monthly': startDate.setMonth(now.getMonth() - 1); break
    case 'yearly': startDate.setFullYear(now.getFullYear() - 1); break
  }
  return startDate
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || 'monthly'
    const startDate = getStartDate(period)
    const isAdmin = user.role === 'super_admin'

    const orders = await db
      .select({ lending_order_id: lending_order.lending_order_id })
      .from(lending_order)
      .where(
        isAdmin
          ? gte(lending_order.created_at, startDate)
          : and(eq(lending_order.issued_by_user_id, user.user_id), gte(lending_order.created_at, startDate))
      )

    const orderIds = orders.map((o) => o.lending_order_id)
    if (orderIds.length === 0) return NextResponse.json([])

    const lendingItems = await db
      .select({
        quantity: lending_item.quantity,
        original_quantity: lending_item.original_quantity,
        product_id: lending_item.product_id,
        products: { product_name: products.product_name },
      })
      .from(lending_item)
      .leftJoin(products, eq(products.product_id, lending_item.product_id))
      .where(inArray(lending_item.lend_order_id, orderIds))

    const productTotals = new Map<string, { product_name: string; total_lent: number }>()

    for (const item of lendingItems) {
      const productId = item.product_id
      const productName = item.products?.product_name || 'Unknown Product'
      const qty = item.original_quantity ?? item.quantity ?? 0

      if (productTotals.has(productId)) {
        productTotals.get(productId)!.total_lent += qty
      } else {
        productTotals.set(productId, { product_name: productName, total_lent: qty })
      }
    }

    const sorted = Array.from(productTotals.entries())
      .map(([product_id, data]) => ({ product_id, product_name: data.product_name, total_lent: data.total_lent }))
      .sort((a, b) => b.total_lent - a.total_lent)

    return NextResponse.json(sorted)
  } catch (error) {
    console.error('[GET /api/dashboard/top-lent] error:', error)
    return NextResponse.json({ error: classifyError(error) }, { status: 500 })
  }
}
