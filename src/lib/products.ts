// Product creation, extracted so it can run inside somebody else's transaction.
//
// This used to live only in POST /api/products. The invoice upload flow needed
// the same thing, and the client solved that by calling POST /api/products in
// a loop before posting the invoice — one HTTP request and one transaction per
// new product. When any later step failed (a line with three decimal places
// was enough), the products already created stayed committed while the invoice
// did not, so retrying created them a second time. Twenty-two line items could
// leave twenty-one orphaned products behind and no invoice.
//
// Putting the logic here lets POST /api/invoices create products inside the
// same transaction that writes the invoice, so the whole upload is one atomic
// unit: all of it lands, or none of it does.

import { eq } from 'drizzle-orm'
import type { Tx } from '@/db/client'
import { products, product_image, category } from '@/db/schema'
import { allocateNextCode, allocateNextSkuCode } from '@/lib/idSequences'
import { suggestCategoryCode } from '@/lib/categoryCode'
import { openStock, type Actor } from '@/lib/stock'
import { ApiError } from '@/lib/api/errors'
import { isTrustedAssetUrl } from '@/lib/cloudinary'

export type NewProductInput = {
  product_name: string
  unit_cost: number
  /** Opening balance. The invoice flow passes 0 and lets the invoice's own line quantity set it. */
  quantity: number
  description?: string | null
  image_url?: string | null
  category_id?: string | null
  location?: string | null
}

export type CreatedProduct = {
  product: typeof products.$inferSelect
  stock: Awaited<ReturnType<typeof openStock>>
}

/**
 * Creates one product, its SKU, and its opening stock row inside `tx`.
 *
 * Every caller must already be in a transaction — the SKU and product_code
 * allocators take row locks that are only meaningful for a transaction's
 * lifetime.
 */
export async function createProductInTx(
  tx: Tx,
  input: NewProductInput,
  opts: { userId: string; actor: Actor },
): Promise<CreatedProduct> {
  if (input.image_url && !isTrustedAssetUrl(input.image_url)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Product image must be an uploaded file')
  }

  if (input.category_id) {
    const [exists] = await tx
      .select({ category_id: category.category_id })
      .from(category)
      .where(eq(category.category_id, input.category_id))
    if (!exists) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That category no longer exists — pick another one')
    }
  }

  const product_code = await allocateNextCode(tx, 'product_code')

  // SKU is always auto-generated, category-scoped, and the barcode payload
  // printed on product labels — never client-supplied.
  let skuPrefix = 'GEN'
  if (input.category_id) {
    const [cat] = await tx
      .select({ category_name: category.category_name, code: category.code })
      .from(category)
      .where(eq(category.category_id, input.category_id))
    if (cat?.code) {
      skuPrefix = cat.code
    } else if (cat) {
      // Category predates the code feature — backfill a unique code now rather
      // than falling back to the shared literal "GEN", which would collide
      // with the uncategorized sequence.
      skuPrefix = await suggestCategoryCode(tx, cat.category_name)
      await tx.update(category).set({ code: skuPrefix }).where(eq(category.category_id, input.category_id))
    }
  }
  const sku_code = await allocateNextSkuCode(tx, input.category_id ?? null, skuPrefix)

  const insertData: typeof products.$inferInsert = {
    product_code,
    product_name: input.product_name,
    unit_cost: String(input.unit_cost),
    user_id: opts.userId,
    sku_code,
  }
  if (input.description) insertData.description = input.description
  if (input.category_id) insertData.category_id = input.category_id

  const [product] = await tx.insert(products).values(insertData).returning()

  const stock = await openStock(tx, {
    productId: product.product_id,
    quantity: input.quantity,
    location: input.location ?? null,
    actor: opts.actor,
  })

  if (input.image_url) {
    await tx.insert(product_image).values({ product_id: product.product_id, image_url: input.image_url })
  }

  return { product, stock }
}
