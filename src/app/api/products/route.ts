import { NextRequest } from 'next/server'
import { and, desc, eq, getTableColumns } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { products, product_image, stocks, category, users, coe_domains } from '@/db/schema'
import { requireUser, productScope } from '@/lib/authz'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok, created } from '@/lib/api/response'
import { actorFrom } from '@/lib/stock'
import { createProductInTx } from '@/lib/products'
import { parseBody, money, nonNegativeQuantity, uuid } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MAX_PAGE_SIZE = 200

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { scope } = auth

  try {
    const { searchParams } = new URL(req.url)
    // SKUs are always generated uppercase — uppercase the incoming param so
    // the scan-to-fetch match is case-insensitive without needing a
    // functional index.
    const sku = searchParams.get('sku')?.trim().toUpperCase()

    // Bounded by default. This endpoint returned every product with its joins
    // and no cap at all, so response size grew without limit as the catalogue
    // did. `limit=0` is not an escape hatch — MAX_PAGE_SIZE is the ceiling.
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

    // Everything in the caller's COE, not just what they personally added.
    const visible = productScope(scope)
    const where = sku ? (visible ? and(eq(products.sku_code, sku), visible) : eq(products.sku_code, sku)) : visible

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
      .where(where)
      .orderBy(desc(products.created_at))
      .limit(sku ? 1 : limit)
      .offset(sku ? 0 : offset)

    // Scan-to-fetch (lending's "Scan SKU" mode): exact match by barcode
    // payload, single-product response instead of a list.
    if (sku) {
      const [match] = rows
      if (!match) throw new ApiError(404, 'NOT_FOUND', 'No product with that SKU')
      return ok(match)
    }

    return ok(rows)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'GET /api/products' })
  }
}

const createProductSchema = z
  .object({
    // Both spellings were accepted before (`name`/`product_name`,
    // `cost`/`unit_cost`, `quantity`/`initial_quantity`) — kept, but now
    // declared rather than resolved with a chain of `??`.
    product_name: z.string().trim().min(1).max(250).optional(),
    name: z.string().trim().min(1).max(250).optional(),
    unit_cost: money.optional(),
    cost: money.optional(),
    quantity: nonNegativeQuantity.optional(),
    initial_quantity: nonNegativeQuantity.optional(),
    description: z.string().trim().max(2000).nullish(),
    image_url: z.string().url().nullish(),
    category_id: uuid.nullish(),
    location: z.string().trim().max(50).nullish(),
  })
  .transform((body, ctx) => {
    const product_name = body.product_name ?? body.name
    const unit_cost = body.unit_cost ?? body.cost
    const quantity = body.quantity ?? body.initial_quantity

    // unit_cost and quantity previously only had to be non-null — a string,
    // an object, or a negative number all sailed through into
    // `String(unit_cost)` and `Number(quantity)`.
    if (!product_name) ctx.addIssue({ code: 'custom', message: 'product_name is required', path: ['product_name'] })
    if (unit_cost === undefined) ctx.addIssue({ code: 'custom', message: 'unit_cost is required', path: ['unit_cost'] })
    if (quantity === undefined) ctx.addIssue({ code: 'custom', message: 'quantity is required', path: ['quantity'] })

    return {
      product_name: product_name as string,
      unit_cost: unit_cost as number,
      quantity: quantity as number,
      description: body.description ?? null,
      image_url: body.image_url ?? null,
      category_id: body.category_id ?? null,
      location: body.location ?? null,
    }
  })

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { user } = auth
  const actor = actorFrom(user, requestIdFrom(req))

  try {
    const body = await parseBody(req, createProductSchema)

    // Image URLs were stored exactly as the client sent them. next/image
    // refuses a foreign host, but the value still reached the database and
    // any consumer not going through next/image would follow it.
    // The body of this used to live here inline. It now lives in
    // src/lib/products.ts so POST /api/invoices can run the identical logic
    // inside its own transaction — see the note at the top of that file.
    const result = await db.transaction(async (tx) =>
      createProductInTx(
        tx,
        {
          product_name: body.product_name,
          unit_cost: body.unit_cost,
          quantity: body.quantity,
          description: body.description,
          image_url: body.image_url,
          category_id: body.category_id,
          location: body.location,
        },
        { userId: user.user_id, actor },
      ),
    )

    return created({
      product: { ...result.product, image_url: body.image_url ?? null },
      stock: result.stock,
    })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: user.user_id, route: 'POST /api/products' })
  }
}
