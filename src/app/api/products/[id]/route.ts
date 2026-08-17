import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
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
} from '@/db/schema'
import { deleteImage, getPublicIdFromUrl } from '@/lib/cloudinary'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'monthly'
    const fromDate = getFromDate(period)

    // super_admin can view any product's detail page (read-only — edits/
    // deletes below stay owner-scoped); everyone else only their own.
    const isAdmin = user.role === 'super_admin'
    const productCond = isAdmin
      ? eq(products.product_id, id)
      : and(eq(products.product_id, id), eq(products.user_id, user.user_id))
    const [product] = await db
      .select()
      .from(products)
      .where(productCond)

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

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

    const enrichedProduct = { ...product, image_url: image?.image_url ?? null, stocks: stockData, category_name: categoryName }

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
          isAdmin
            ? inArray(lending_order.lending_order_id, orderIds)
            : and(inArray(lending_order.lending_order_id, orderIds), eq(lending_order.issued_by_user_id, user.user_id))
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

    return NextResponse.json({ product: enrichedProduct, lendingSummary, borrowingHistory })
  } catch (err) {
    console.error('Error fetching product detail:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await request.json()

    // sku_code is intentionally not editable here — it's auto-generated at
    // creation and printed as a barcode; changing it after the fact would
    // orphan any already-printed label.
    const updateData: Partial<typeof products.$inferInsert> = {}
    if (body.product_name !== undefined) updateData.product_name = body.product_name
    if (body.unit_cost !== undefined) updateData.unit_cost = String(body.unit_cost)
    if (body.description !== undefined) updateData.description = typeof body.description === 'string' ? body.description.slice(0, 2000) : null
    if (body.category_id !== undefined) updateData.category_id = body.category_id

    // super_admin can edit any user's product (manages inventory across every
    // domain); everyone else only their own.
    const productCond = user.role === 'super_admin'
      ? eq(products.product_id, id)
      : and(eq(products.product_id, id), eq(products.user_id, user.user_id))
    const [updated] = await db
      .update(products)
      .set(updateData)
      .where(productCond)
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    let returnedImageUrl: string | null = null
    if (body.image_url !== undefined) {
      const [existing] = await db.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))
      if (existing) {
        await db.update(product_image).set({ image_url: body.image_url }).where(eq(product_image.product_id, id))
      } else {
        await db.insert(product_image).values({ product_id: id, image_url: body.image_url })
      }
      returnedImageUrl = body.image_url
    } else {
      const [img] = await db.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))
      returnedImageUrl = img?.image_url ?? null
    }

    return NextResponse.json({ ...updated, image_url: returnedImageUrl })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params

    // super_admin can delete any user's product; everyone else only their own.
    const deleteCond = user.role === 'super_admin'
      ? eq(products.product_id, id)
      : and(eq(products.product_id, id), eq(products.user_id, user.user_id))
    const [owned] = await db.select({ product_id: products.product_id }).from(products).where(deleteCond)
    if (!owned) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const images = await db.select({ image_url: product_image.image_url }).from(product_image).where(eq(product_image.product_id, id))

    // Transactional: a partial delete (e.g. stock/lending rows gone but the
    // product row itself blocked by a FK) would leave the catalog corrupted.
    await db.transaction(async (tx) => {
      const items = await tx.select({ lend_order_id: lending_item.lend_order_id }).from(lending_item).where(eq(lending_item.product_id, id))
      const orderIds = [...new Set(items.map((li) => li.lend_order_id))]

      await tx.delete(lending_item).where(eq(lending_item.product_id, id))
      if (orderIds.length > 0) {
        await tx.delete(lending_order).where(inArray(lending_order.lending_order_id, orderIds))
      }
      await tx.delete(stocks).where(eq(stocks.product_id, id))
      await tx.delete(product_image).where(eq(product_image.product_id, id))
      // purchase_invoice_item.product_id is ON DELETE RESTRICT — past invoice
      // line items must survive product deletion as a purchase record, so
      // unlink rather than delete them (product_name is already stored on the
      // row for exactly this case, see purchaseInvoiceItem.ts).
      await tx.update(purchase_invoice_item).set({ product_id: null }).where(eq(purchase_invoice_item.product_id, id))
      await tx.delete(products).where(eq(products.product_id, id))
    })

    for (const img of images) {
      const publicId = getPublicIdFromUrl(img.image_url)
      if (publicId) {
        try {
          await deleteImage(publicId)
        } catch (err) {
          console.error('Failed to delete product image from storage:', err)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}
