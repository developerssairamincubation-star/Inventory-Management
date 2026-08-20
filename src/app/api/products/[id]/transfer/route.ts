import { NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { products, stocks, product_image, category, users, coe_domains, stock_transfers } from '@/db/schema'
import { allocateNextCode, allocateNextSkuCode } from '@/lib/idSequences'
import { suggestCategoryCode } from '@/lib/categoryCode'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { requireUser, productScope } from '@/lib/authz'
import { adjustStock, openStock, lockStock, recordStockEvent, actorFrom } from '@/lib/stock'
import { parseBody, parseUuidParam, positiveQuantity, uuid } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

// This route already validated its input thoroughly and already re-read stock
// inside the transaction — it was the one place in the codebase doing both.
// The changes here are to share the scope predicate with every other route
// and to route stock changes through the locking helper so transfers land in
// the audit ledger alongside every other movement.
const transferSchema = z.object({
  target_domain_id: uuid,
  quantity: positiveQuantity,
  location: z.string().trim().max(50).nullish(),
})

// Moves stock from one COE domain to another. Products/stocks carry no
// domain_id of their own — a product's domain is whichever COE its owning
// user (users.domain_id) belongs to, same as every other domain-scoped
// route in this app. Two modes, chosen automatically by comparing the
// requested quantity to what's currently available:
//
//  - full (quantity === all available stock): reassign products.user_id to
//    a user in the destination domain. Same product row — SKU, barcode,
//    image, lending history all just move with it.
//  - partial (quantity < available stock): a single product row can't have
//    two owners, so a new product row is created for the destination
//    domain (fresh product_code/sku_code, same name/category/cost/
//    description/image) and the source stock is decremented.
//
// Only stocks.quantity (available stock) is ever transferable — damaged/
// lost units stay with the source.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { user, scope } = auth
  const actor = actorFrom(user, requestIdFrom(request))

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const { target_domain_id, quantity, location } = await parseBody(request, transferSchema)
    const cleanLocation = location === undefined ? undefined : (location || null)

    const visible = productScope(scope)
    const productCond = visible ? and(eq(products.product_id, id), visible) : eq(products.product_id, id)
    const [product] = await db
      .select({
        product_id: products.product_id,
        user_id: products.user_id,
        product_name: products.product_name,
        unit_cost: products.unit_cost,
        category_id: products.category_id,
        description: products.description,
      })
      .from(products)
      .where(productCond)
    if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product not found')

    const [owner] = await db.select({ domain_id: users.domain_id }).from(users).where(eq(users.user_id, product.user_id as string))
    const sourceDomainId = owner?.domain_id ?? null
    if (!sourceDomainId) {
      throw new ApiError(400, 'VALIDATION_ERROR', "This product's owner isn't assigned to a COE domain, so it can't be transferred.")
    }
    if (target_domain_id === sourceDomainId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Pick a different domain to transfer to')
    }

    const [targetDomain] = await db.select({ domain_id: coe_domains.domain_id, domain_name: coe_domains.domain_name }).from(coe_domains).where(eq(coe_domains.domain_id, target_domain_id))
    if (!targetDomain) throw new ApiError(400, 'VALIDATION_ERROR', 'target_domain_id does not reference an existing COE domain')

    // The UI only offers a target domain, not a user — resolve the
    // receiving user server-side. In practice each domain has exactly one
    // active user; if it somehow has several, the oldest wins (documented
    // here rather than surfacing a user picker for a case that shouldn't
    // normally happen).
    const [destUser] = await db
      .select({ user_id: users.user_id })
      .from(users)
      .where(and(eq(users.domain_id, target_domain_id), eq(users.is_active, true)))
      .orderBy(asc(users.created_at))
      .limit(1)
    if (!destUser) {
      throw new ApiError(400, 'VALIDATION_ERROR', `No active user is assigned to "${targetDomain.domain_name}" yet — ask a super_admin to assign one before transferring stock there.`)
    }

    const result = await db.transaction(async (tx) => {
      // Re-read inside the transaction (rather than trusting a pre-tx read)
      // so a concurrent stock change can't push this transfer past what's
      // actually available.
      // FOR UPDATE, so a concurrent lend or restock can't slip between the
      // availability check and the decrement below.
      const stockRow = await lockStock(tx, id)
      if (quantity > stockRow.quantity) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Only ${stockRow.quantity} unit(s) available to transfer`)
      }

      const isFull = quantity === stockRow.quantity
      let destinationProductId: string

      if (isFull) {
        await tx.update(products).set({ user_id: destUser.user_id }).where(eq(products.product_id, id))
        if (cleanLocation !== undefined) {
          await tx.update(stocks).set({ location: cleanLocation }).where(eq(stocks.product_id, id))
        }
        destinationProductId = id
      } else {
        await adjustStock(tx, {
          productId: id,
          delta: -quantity,
          reason: 'TRANSFER_OUT',
          actor,
          note: `Transferred to ${targetDomain.domain_name}`,
        })

        // Category-scoped SKU prefix, same self-heal logic as POST /api/products.
        let skuPrefix = 'GEN'
        if (product.category_id) {
          const [cat] = await tx.select({ category_name: category.category_name, code: category.code }).from(category).where(eq(category.category_id, product.category_id))
          if (cat?.code) {
            skuPrefix = cat.code
          } else if (cat) {
            skuPrefix = await suggestCategoryCode(tx, cat.category_name)
            await tx.update(category).set({ code: skuPrefix }).where(eq(category.category_id, product.category_id))
          }
        }
        const product_code = await allocateNextCode(tx, 'product_code')
        const sku_code = await allocateNextSkuCode(tx, product.category_id, skuPrefix)

        const insertData: typeof products.$inferInsert = {
          product_code,
          product_name: product.product_name,
          unit_cost: product.unit_cost,
          user_id: destUser.user_id,
          sku_code,
        }
        if (product.description) insertData.description = product.description
        if (product.category_id) insertData.category_id = product.category_id

        const [newProduct] = await tx.insert(products).values(insertData).returning({ product_id: products.product_id })
        await openStock(tx, {
          productId: newProduct.product_id,
          quantity,
          location: cleanLocation || null,
          actor,
        })

        const [sourceImage] = await tx.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))
        if (sourceImage) {
          await tx.insert(product_image).values({ product_id: newProduct.product_id, image_url: sourceImage.image_url })
        }
        destinationProductId = newProduct.product_id
      }

      await tx.insert(stock_transfers).values({
        source_product_id: id,
        destination_product_id: destinationProductId,
        source_domain_id: sourceDomainId,
        destination_domain_id: target_domain_id,
        quantity,
        mode: isFull ? 'full' : 'partial',
        transferred_by_user_id: user.user_id,
      })

      if (isFull) {
        // Ownership moved rather than quantity, so the shelf count is
        // unchanged — but the transfer still belongs in the audit trail.
        await recordStockEvent(tx, {
          productId: id,
          reason: 'TRANSFER_OUT',
          actor,
          note: `Full transfer to ${targetDomain.domain_name} (ownership reassigned, quantity unchanged)`,
        })
      }

      return { mode: isFull ? 'full' as const : 'partial' as const, destination_product_id: destinationProductId }
    })

    return ok({
      ...result,
      quantity,
      destination_domain: { domain_id: targetDomain.domain_id, domain_name: targetDomain.domain_name },
    })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: user.user_id, route: 'POST /api/products/[id]/transfer' })
  }
}
