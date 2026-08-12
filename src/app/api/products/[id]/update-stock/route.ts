import { NextRequest, NextResponse } from 'next/server'
import { and, eq, getTableColumns } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await request.json()
    const { additionalStock, unitCost, newStock } = body

    if (additionalStock !== undefined && (typeof additionalStock !== 'number' || additionalStock < 0)) {
      return NextResponse.json({ error: 'Invalid additional stock value' }, { status: 400 })
    }
    if (newStock !== undefined && (typeof newStock !== 'number' || newStock < 0)) {
      return NextResponse.json({ error: 'Invalid stock value' }, { status: 400 })
    }
    if (unitCost !== undefined && (typeof unitCost !== 'number' || unitCost < 0)) {
      return NextResponse.json({ error: 'Invalid unit cost value' }, { status: 400 })
    }

    const [owned] = await db.select({ product_id: products.product_id }).from(products).where(and(eq(products.product_id, id), eq(products.user_id, user.user_id)))
    if (!owned) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const [currentStock] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, id))
    if (!currentStock) {
      return NextResponse.json({ error: 'Stock record not found' }, { status: 500 })
    }

    if (newStock !== undefined || additionalStock !== undefined) {
      const newQuantity = newStock !== undefined ? newStock : (currentStock.quantity || 0) + (additionalStock as number)
      await db.update(stocks).set({ quantity: newQuantity }).where(eq(stocks.product_id, id))
    }

    if (unitCost !== undefined) {
      await db.update(products).set({ unit_cost: String(unitCost) }).where(eq(products.product_id, id))
    }

    const [updatedProduct] = await db
      .select({ ...getTableColumns(products), stocks: { quantity: stocks.quantity } })
      .from(products)
      .leftJoin(stocks, eq(stocks.product_id, products.product_id))
      .where(eq(products.product_id, id))

    return NextResponse.json({ success: true, product: updatedProduct })
  } catch {
    return NextResponse.json({ error: 'Failed to update stock' }, { status: 500 })
  }
}
