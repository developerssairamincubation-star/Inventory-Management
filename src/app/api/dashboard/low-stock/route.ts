import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const productsData = await db
      .select({
        product_id: products.product_id,
        product_name: products.product_name,
        product_code: products.product_code,
        low_stock_threshold: products.low_stock_threshold,
        stocks: { quantity: stocks.quantity },
      })
      .from(products)
      .leftJoin(stocks, eq(stocks.product_id, products.product_id))
      .where(and(eq(products.user_id, user.user_id), isNotNull(products.low_stock_threshold)))

    const lowStockProducts = productsData
      .filter((product) => {
        const currentStock = product.stocks?.quantity ?? 0
        const threshold = product.low_stock_threshold
        return threshold && currentStock <= threshold
      })
      .map((product) => ({
        product_id: product.product_id,
        product_name: product.product_name,
        product_code: product.product_code,
        current_stock: product.stocks?.quantity ?? 0,
        threshold: product.low_stock_threshold,
      }))

    return NextResponse.json(lowStockProducts)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}
