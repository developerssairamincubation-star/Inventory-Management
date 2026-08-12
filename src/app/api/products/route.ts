import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, getTableColumns } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks, product_image, category } from '@/db/schema'
import { allocateNextCode } from '@/lib/idSequences'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const rows = await db
      .select({
        ...getTableColumns(products),
        image_url: product_image.image_url,
        category_name: category.category_name,
      })
      .from(products)
      .leftJoin(product_image, eq(product_image.product_id, products.product_id))
      .leftJoin(category, eq(category.category_id, products.category_id))
      .where(eq(products.user_id, user.user_id))
      .orderBy(desc(products.created_at))

    return NextResponse.json(rows)
  } catch (err) {
    console.error('Server error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()

    const product_name = body.name ?? body.product_name
    const serial_number = body.sku ?? body.serial_number
    const unit_cost = body.cost ?? body.unit_cost
    const low_stock_threshold = body.low_stock_threshold ?? body.lowStockThreshold ?? null
    const image_url: string | null = body.image_url ?? null
    // Determine `returnable` / `consumable` only when provided or derivable.
    // If neither is provided, leave them undefined so DB defaults apply.
    const hasReturnable = typeof body.returnable === 'boolean'
    const hasConsumable = typeof body.consumable === 'boolean'
    let returnable: boolean | undefined
    let consumable: boolean | undefined
    if (hasReturnable) returnable = body.returnable
    if (hasConsumable) consumable = body.consumable
    if (!hasReturnable && hasConsumable) returnable = !body.consumable

    const quantity = body.quantity ?? body.initial_quantity ?? null
    const category_id = body.category_id ?? null

    if (!product_name || unit_cost == null || quantity == null) {
      return NextResponse.json({ error: 'Missing required fields: product_name, unit_cost, quantity' }, { status: 400 })
    }

    const result = await db.transaction(async (tx) => {
      const product_code = await allocateNextCode(tx, 'product_code')

      const insertData: typeof products.$inferInsert = {
        product_code,
        product_name,
        unit_cost: String(unit_cost),
        user_id: user.user_id,
      }
      if (consumable !== undefined) insertData.consumable = consumable
      if (returnable !== undefined) insertData.returnable = returnable
      if (serial_number) insertData.serial_number = serial_number
      if (low_stock_threshold !== null && low_stock_threshold !== undefined) insertData.low_stock_threshold = low_stock_threshold
      if (category_id) insertData.category_id = category_id

      const [product] = await tx.insert(products).values(insertData).returning()

      const [stock] = await tx.insert(stocks).values({ product_id: product.product_id, quantity: Number(quantity) }).returning()

      if (image_url) {
        await tx.insert(product_image).values({ product_id: product.product_id, image_url })
      }

      return { product, stock }
    })

    return NextResponse.json({ product: { ...result.product, image_url: image_url ?? null }, stock: result.stock }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid JSON' }, { status: 400 })
  }
}
