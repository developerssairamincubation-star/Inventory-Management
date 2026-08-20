import { NextRequest } from 'next/server'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { db } from '@/db/client'
import {
  products,
  product_image,
  stocks,
  category,
  lending_item,
  lending_order,
  purchase_invoice_item,
  students,
  departments,
  users,
  coe_domains,
  stock_transfers,
} from '@/db/schema'
import { deleteImage, getPublicIdFromUrl, isTrustedAssetUrl } from '@/lib/cloudinary'
import { requireUser, productScope, lendingScope, type Scope } from '@/lib/authz'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { parseBody, parseUuidParam, money, uuid } from '@/lib/validation'
import { requestIdFrom, logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

function getFromDate(period: string): Date {
  const now = new Date()
  switch (period) {
    case 'daily': { const d = new Date(now); d.setHours(0, 0, 0, 0); return d }
    case 'weekly': { const d = new Date(now); d.setDate(now.getDate() - 7); return d }
    case 'yearly': { const d = new Date(now); d.setFullYear(now.getFullYear() - 1); return d }
    case 'monthly':
    default: { const d = new Date(now); d.setMonth(now.getMonth() - 1); return d }
  }
}

const FINAL_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST', 'DAMAGED', 'LOST', 'CONSUMABLE']

/** Loads a product the caller is allowed to act on, or null. */
async function findVisibleProduct(scope: Scope, id: string) {
  const visible = productScope(scope)
  const [product] = await db
    .select()
    .from(products)
    .where(visible ? and(eq(products.product_id, id), visible) : eq(products.product_id, id))
  return product ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { scope } = auth

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'monthly'
    const fromDate = getFromDate(period)

    const product = await findVisibleProduct(scope, id)
    if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product not found')

    const [image] = await db.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))
    const [stockRow] = await db
      .select({ quantity: stocks.quantity, damaged_quantity: stocks.damaged_quantity, lost_quantity: stocks.lost_quantity, location: stocks.location })
      .from(stocks)
      .where(eq(stocks.product_id, id))

    const stockData = stockRow
      ? { quantity: stockRow.quantity ?? 0, damaged_quantity: stockRow.damaged_quantity ?? 0, lost_quantity: stockRow.lost_quantity ?? 0, location: stockRow.location ?? null }
      : { quantity: 0, damaged_quantity: 0, lost_quantity: 0, location: null }

    let categoryName: string | null = null
    if (product.category_id) {
      const [catRow] = await db.select({ category_name: category.category_name }).from(category).where(eq(category.category_id, product.category_id))
      categoryName = catRow?.category_name ?? null
    }

    // Which COE domain this product belongs to — derived from its owner, the
    // same derivation the authorization layer uses.
    let domainId: string | null = null
    let domainName: string | null = null
    if (product.user_id) {
      const [ownerRow] = await db
        .select({ domain_id: coe_domains.domain_id, domain_name: coe_domains.domain_name })
        .from(users)
        .leftJoin(coe_domains, eq(coe_domains.domain_id, users.domain_id))
        .where(eq(users.user_id, product.user_id))
      domainId = ownerRow?.domain_id ?? null
      domainName = ownerRow?.domain_name ?? null
    }

    const enrichedProduct = { ...product, image_url: image?.image_url ?? null, stocks: stockData, category_name: categoryName, domain_id: domainId, domain_name: domainName }

    const sourceDomainAlias = alias(coe_domains, 'source_domain')
    const destDomainAlias = alias(coe_domains, 'dest_domain')
    const transferHistory = await db
      .select({
        transfer_id: stock_transfers.transfer_id,
        quantity: stock_transfers.quantity,
        mode: stock_transfers.mode,
        created_at: stock_transfers.created_at,
        source_domain_name: sourceDomainAlias.domain_name,
        destination_domain_name: destDomainAlias.domain_name,
        transferred_by_name: users.full_name,
      })
      .from(stock_transfers)
      .leftJoin(sourceDomainAlias, eq(sourceDomainAlias.domain_id, stock_transfers.source_domain_id))
      .leftJoin(destDomainAlias, eq(destDomainAlias.domain_id, stock_transfers.destination_domain_id))
      .leftJoin(users, eq(users.user_id, stock_transfers.transferred_by_user_id))
      .where(or(eq(stock_transfers.source_product_id, id), eq(stock_transfers.destination_product_id, id)))
      .orderBy(desc(stock_transfers.created_at))

    const lendingItems = await db
      .select({
        lend_order_id: lending_item.lend_order_id,
        quantity: lending_item.quantity,
        original_quantity: lending_item.original_quantity,
        damaged_quantity: lending_item.damaged_quantity,
        lost_quantity: lending_item.lost_quantity,
      })
      .from(lending_item)
      .where(eq(lending_item.product_id, id))

    const orderIds = lendingItems.map((li) => li.lend_order_id)

    type BorrowingHistoryRow = {
      sno: number
      lending_order_id: string
      borrower_name: string
      borrower_type: string
      department: string
      borrow_date: Date
      return_date: string | null
      due_date: string | null
      status: string
      quantity: number
      original_quantity: number
      damaged_quantity: number
      lost_quantity: number
    }

    let borrowingHistory: BorrowingHistoryRow[] = []
    const lendingSummary = { totalLent: 0, returned: 0 }

    if (orderIds.length > 0) {
      const visibleLending = lendingScope(scope)
      const orders = await db
        .select({
          lending_order_id: lending_order.lending_order_id,
          created_at: lending_order.created_at,
          due_date: lending_order.due_date,
          return_date: lending_order.return_date,
          status: lending_order.status,
          borrower_type: lending_order.borrower_type,
          borrower_student_id: lending_order.borrower_student_id,
        })
        .from(lending_order)
        .where(
          visibleLending
            ? and(inArray(lending_order.lending_order_id, orderIds), visibleLending)
            : inArray(lending_order.lending_order_id, orderIds),
        )
        .orderBy(desc(lending_order.created_at))

      if (orders.length > 0) {
        const qtyByOrder = new Map<string, number>()
        const origQtyByOrder = new Map<string, number>()
        const damagedByOrder = new Map<string, number>()
        const lostByOrder = new Map<string, number>()
        for (const li of lendingItems) {
          const currentQty = li.quantity ?? 0
          const origQty = li.original_quantity != null && li.original_quantity > 0 ? li.original_quantity : currentQty
          qtyByOrder.set(li.lend_order_id, currentQty)
          origQtyByOrder.set(li.lend_order_id, origQty)
          damagedByOrder.set(li.lend_order_id, li.damaged_quantity ?? 0)
          lostByOrder.set(li.lend_order_id, li.lost_quantity ?? 0)
        }

        const ordersInPeriod = orders.filter((o) => o.created_at >= fromDate)
        lendingSummary.totalLent = ordersInPeriod.reduce((s, o) => s + (origQtyByOrder.get(o.lending_order_id) || 0), 0)
        lendingSummary.returned = ordersInPeriod
          .filter((o) => ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'].includes(o.status))
          .reduce((s, o) => {
            const orig = origQtyByOrder.get(o.lending_order_id) || 0
            const dmg = damagedByOrder.get(o.lending_order_id) || 0
            const lst = lostByOrder.get(o.lending_order_id) || 0
            return s + Math.max(0, orig - dmg - lst)
          }, 0)

        const studentIds = [...new Set(orders.filter((o) => o.borrower_student_id).map((o) => o.borrower_student_id as string))]

        const studentRows = studentIds.length > 0
          ? await db
              .select({
                student_id: students.student_id,
                name: students.name,
                departments: { department_name: departments.department_name },
              })
              .from(students)
              .leftJoin(departments, eq(departments.department_id, students.department_id))
              .where(inArray(students.student_id, studentIds))
          : []

        const studentMap = new Map(studentRows.map((s) => [s.student_id, s]))

        borrowingHistory = orders.map((order, idx) => {
          let borrowerName = '—'
          let department = '—'
          if (order.borrower_student_id) {
            const student = studentMap.get(order.borrower_student_id)
            borrowerName = student?.name || '—'
            department = student?.departments?.department_name || '—'
          }
          const currentQty = qtyByOrder.get(order.lending_order_id) ?? 0
          const originalQty = origQtyByOrder.get(order.lending_order_id) ?? currentQty
          const damagedQty = damagedByOrder.get(order.lending_order_id) || 0
          const lostQty = lostByOrder.get(order.lending_order_id) || 0
          const isFullyReturned = FINAL_STATUSES.includes(order.status)
          return {
            sno: idx + 1,
            lending_order_id: order.lending_order_id,
            borrower_name: borrowerName,
            borrower_type: order.borrower_type,
            department,
            borrow_date: order.created_at,
            return_date: order.return_date,
            due_date: order.due_date,
            status: order.status,
            quantity: isFullyReturned ? 0 : currentQty,
            original_quantity: originalQty,
            damaged_quantity: damagedQty,
            lost_quantity: lostQty,
          }
        })
      }
    }

    return ok({ product: enrichedProduct, lendingSummary, borrowingHistory, transferHistory })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: auth.user.user_id, route: 'GET /api/products/[id]' })
  }
}

const updateProductSchema = z.object({
  product_name: z.string().trim().min(1).max(250).optional(),
  unit_cost: money.optional(),
  description: z.string().trim().max(2000).nullish(),
  category_id: uuid.nullish(),
  image_url: z.string().url().nullish(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { user, scope } = auth

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const body = await parseBody(request, updateProductSchema)

    if (body.image_url && !isTrustedAssetUrl(body.image_url)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Product image must be an uploaded file')
    }

    // sku_code is intentionally not editable — it's auto-generated at
    // creation and printed as a barcode; changing it after the fact would
    // orphan any already-printed label.
    const updateData: Partial<typeof products.$inferInsert> = {}
    if (body.product_name !== undefined) updateData.product_name = body.product_name
    if (body.unit_cost !== undefined) updateData.unit_cost = String(body.unit_cost)
    if (body.description !== undefined) updateData.description = body.description
    if (body.category_id !== undefined) updateData.category_id = body.category_id

    const result = await db.transaction(async (tx) => {
      const visible = productScope(scope)
      const [owned] = await tx
        .select({ product_id: products.product_id })
        .from(products)
        .where(visible ? and(eq(products.product_id, id), visible) : eq(products.product_id, id))
      if (!owned) throw new ApiError(404, 'NOT_FOUND', 'Product not found')

      // `.set({})` on an empty object throws in Drizzle — a body with no
      // updatable field used to surface as an opaque 500.
      let updated = null
      if (Object.keys(updateData).length > 0) {
        ;[updated] = await tx.update(products).set(updateData).where(eq(products.product_id, id)).returning()
      } else {
        ;[updated] = await tx.select().from(products).where(eq(products.product_id, id))
      }

      let returnedImageUrl: string | null = null
      if (body.image_url !== undefined) {
        if (body.image_url === null) {
          await tx.delete(product_image).where(eq(product_image.product_id, id))
        } else {
          const [existing] = await tx.select({ image_id: product_image.image_id }).from(product_image).where(eq(product_image.product_id, id))
          if (existing) {
            await tx.update(product_image).set({ image_url: body.image_url }).where(eq(product_image.product_id, id))
          } else {
            await tx.insert(product_image).values({ product_id: id, image_url: body.image_url })
          }
          returnedImageUrl = body.image_url
        }
      } else {
        const [img] = await tx.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))
        returnedImageUrl = img?.image_url ?? null
      }

      return { ...updated, image_url: returnedImageUrl }
    })

    return ok(result)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: user.user_id, route: 'PUT /api/products/[id]' })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { user, scope } = auth

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)

    const images = await db.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))

    await db.transaction(async (tx) => {
      const visible = productScope(scope)
      const [owned] = await tx
        .select({ product_id: products.product_id })
        .from(products)
        .where(visible ? and(eq(products.product_id, id), visible) : eq(products.product_id, id))
      if (!owned) throw new ApiError(404, 'NOT_FOUND', 'Product not found')

      // Refuse while anything is still out on loan. Deleting used to silently
      // destroy the loan record along with the product, so units physically
      // in a student's hands simply vanished from the ledger.
      const [outstanding] = await tx
        .select({ total: sql<number>`coalesce(sum(${lending_item.quantity}), 0)::int` })
        .from(lending_item)
        .where(eq(lending_item.product_id, id))

      if ((outstanding?.total ?? 0) > 0) {
        throw new ApiError(
          409,
          'PRODUCT_ON_LOAN',
          `This product still has ${outstanding.total} unit(s) out on loan. Record the return or write them off before deleting it.`,
        )
      }

      // The destructive bug this replaces: the old code collected every order
      // that had ever contained this product, deleted only *this* product's
      // line items, then deleted those orders wholesale — so in any
      // multi-item order the other products' line items were swept away by
      // ON DELETE CASCADE, destroying unrelated lending history that may have
      // belonged to a different user in a different COE.
      //
      // Only this product's line items are removed. An order is deleted only
      // if removing them leaves it with nothing at all.
      const affected = await tx
        .select({ lend_order_id: lending_item.lend_order_id })
        .from(lending_item)
        .where(eq(lending_item.product_id, id))
      const affectedOrderIds = [...new Set(affected.map((li) => li.lend_order_id))]

      await tx.delete(lending_item).where(eq(lending_item.product_id, id))

      if (affectedOrderIds.length > 0) {
        const survivors = await tx
          .select({ lend_order_id: lending_item.lend_order_id })
          .from(lending_item)
          .where(inArray(lending_item.lend_order_id, affectedOrderIds))
        const stillPopulated = new Set(survivors.map((s) => s.lend_order_id))
        const emptied = affectedOrderIds.filter((orderId) => !stillPopulated.has(orderId))
        if (emptied.length > 0) {
          await tx.delete(lending_order).where(inArray(lending_order.lending_order_id, emptied))
        }
      }

      await tx.delete(stocks).where(eq(stocks.product_id, id))
      await tx.delete(product_image).where(eq(product_image.product_id, id))
      // purchase_invoice_item.product_id is ON DELETE RESTRICT — past invoice
      // line items must survive product deletion as a purchase record, so
      // unlink rather than delete them (product_name is already stored on the
      // row for exactly this case).
      await tx.update(purchase_invoice_item).set({ product_id: null }).where(eq(purchase_invoice_item.product_id, id))
      await tx.delete(products).where(eq(products.product_id, id))
    })

    // After the commit: a failure here leaves an orphaned Cloudinary file,
    // which is recoverable, whereas deleting first would lose the file if the
    // transaction then rolled back.
    for (const img of images) {
      const publicId = getPublicIdFromUrl(img.image_url)
      if (!publicId) continue
      try {
        await deleteImage(publicId)
      } catch (err) {
        logger.warn('Failed to delete product image from storage', { productId: id, publicId }, err)
      }
    }

    return ok({ success: true })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: user.user_id, route: 'DELETE /api/products/[id]' })
  }
}
