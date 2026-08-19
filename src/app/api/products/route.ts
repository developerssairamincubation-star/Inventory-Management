import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, getTableColumns } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks, product_image, category, users, coe_domains } from '@/db/schema'
import { allocateNextCode, allocateNextSkuCode } from '@/lib/idSequences'
import { suggestCategoryCode } from '@/lib/categoryCode'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { classifyError } from '@/lib/api/classifyError'
import { reportError } from '@/lib/api/reportError'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    // SKUs are always generated uppercase — uppercase the incoming param so
    // the scan-to-fetch match is case-insensitive without needing a
    // functional index.
    const sku = searchParams.get('sku')?.trim().toUpperCase()
    // super_admin sees every user's/domain's stock, not just their own —
    // everyone else stays scoped to products they personally added.
    const isAdmin = user.role === 'super_admin'

    const rows = await db
      .select({
        ...getTableColumns(products),
        image_url: product_image.image_url,
        category_name: category.category_name,
        stocks: { quantity: stocks.quantity, location: stocks.location },
        owner_name: users.full_name,
        domain_id: coe_domains.domain_id,
        domain_name: coe_domains.domain_name,
      })
      .from(products)
      .leftJoin(stocks, eq(stocks.product_id, products.product_id))
      .leftJoin(product_image, eq(product_image.product_id, products.product_id))
      .leftJoin(category, eq(category.category_id, products.category_id))
      .leftJoin(users, eq(users.user_id, products.user_id))
      .leftJoin(coe_domains, eq(coe_domains.domain_id, users.domain_id))
      .where(
        isAdmin
          ? (sku ? eq(products.sku_code, sku) : undefined)
          : (sku ? and(eq(products.user_id, user.user_id), eq(products.sku_code, sku)) : eq(products.user_id, user.user_id))
      )
      .orderBy(desc(products.created_at))

    // Scan-to-fetch (lending's "Scan SKU" mode): exact match by barcode
    // payload, single-product response instead of a list.
    if (sku) {
      const [match] = rows
      if (!match) return NextResponse.json({ error: 'No product with that SKU' }, { status: 404 })
      return NextResponse.json(match)
    }

    return NextResponse.json(rows)
  } catch (error) {
    console.error('[GET /api/products] error:', error)
    reportError(error, { source: '[GET /api/products] error' })
    return NextResponse.json({ error: classifyError(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()

    const product_name = body.name ?? body.product_name
    const unit_cost = body.cost ?? body.unit_cost
    const description: string | null = typeof body.description === 'string' ? body.description.slice(0, 2000) : null
    const image_url: string | null = body.image_url ?? null

    const quantity = body.quantity ?? body.initial_quantity ?? null
    const category_id = body.category_id ?? null
    const location: string | null = typeof body.location === 'string' && body.location.trim() ? body.location.trim().slice(0, 50) : null

    if (!product_name || unit_cost == null || quantity == null) {
      return NextResponse.json({ error: 'Missing required fields: product_name, unit_cost, quantity' }, { status: 400 })
    }

    const result = await db.transaction(async (tx) => {
      const product_code = await allocateNextCode(tx, 'product_code')

      // SKU is always auto-generated, category-scoped, and the barcode
      // payload printed on product labels — never client-supplied.
      let skuPrefix = 'GEN'
      if (category_id) {
        const [cat] = await tx.select({ category_name: category.category_name, code: category.code }).from(category).where(eq(category.category_id, category_id))
        if (cat?.code) {
          skuPrefix = cat.code
        } else if (cat) {
          // This category predates the code feature (or was created without
          // one) — backfill a unique code now, the same collision-avoiding
          // suggestion used at category-creation time, instead of falling
          // back to the shared literal "GEN". Two categories without a code
          // both defaulting to "GEN" would generate colliding SKUs (the
          // uncategorized-product sequence uses "GEN" too) — persisting a
          // real code here the first time it's needed closes that gap for
          // every future product in this category, not just this one.
          skuPrefix = await suggestCategoryCode(tx, cat.category_name)
          await tx.update(category).set({ code: skuPrefix }).where(eq(category.category_id, category_id))
        }
      }
      const sku_code = await allocateNextSkuCode(tx, category_id, skuPrefix)

      const insertData: typeof products.$inferInsert = {
        product_code,
        product_name,
        unit_cost: String(unit_cost),
        user_id: user.user_id,
        sku_code,
      }
      if (description) insertData.description = description
      if (category_id) insertData.category_id = category_id

      const [product] = await tx.insert(products).values(insertData).returning()

      const [stock] = await tx.insert(stocks).values({ product_id: product.product_id, quantity: Number(quantity), location }).returning()

      if (image_url) {
        await tx.insert(product_image).values({ product_id: product.product_id, image_url })
      }

      return { product, stock }
    })

    return NextResponse.json({ product: { ...result.product, image_url: image_url ?? null }, stock: result.stock }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/products] error:', error)
    reportError(error, { source: '[POST /api/products] error' })
    // A malformed request body (req.json() failing) is genuinely a client
    // error; anything past that point (DB failures inside the transaction,
    // etc.) is not — those get the correct 500 instead of being mislabeled.
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid request — please check the form and try again.' }, { status: 400 })
    }
    return NextResponse.json({ error: classifyError(error) }, { status: 500 })
  }
}
