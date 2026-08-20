import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { lending_order, lending_item } from "@/db/schema";
import { requireUser, lendingScope, type Scope } from "@/lib/authz";
import { ApiError } from "@/lib/api/errors";
import { fromError, ok } from "@/lib/api/response";
import { adjustStock, actorFrom, type Actor } from "@/lib/stock";
import { parseBody, parseUuidParam, nonNegativeQuantity, isoDateOnly, uuid } from "@/lib/validation";
import { requestIdFrom } from "@/lib/logger";
import type { Tx } from "@/db/client";

/** Loads an order the caller is allowed to act on, or 404s. */
async function findVisibleOrder(scope: Scope, id: string) {
  const visible = lendingScope(scope)
  const [order] = await db
    .select({ lending_order_id: lending_order.lending_order_id, status: lending_order.status })
    .from(lending_order)
    .where(visible ? and(eq(lending_order.lending_order_id, id), visible) : eq(lending_order.lending_order_id, id))
  return order ?? null
}

export async function DELETE(
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

    const order = await findVisibleOrder(scope, id)
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Lending record not found')

    await db.transaction(async (tx) => {
      const items = await tx
        .select({ product_id: lending_item.product_id, quantity: lending_item.quantity })
        .from(lending_item)
        .where(eq(lending_item.lend_order_id, id))

      await tx.delete(lending_item).where(eq(lending_item.lend_order_id, id))
      await tx.delete(lending_order).where(eq(lending_order.lending_order_id, id))

      // Only the still-outstanding balance goes back on the shelf. Units
      // already written off as damaged or lost are not returned by deleting
      // the record that describes them.
      for (const item of items) {
        if (!item.product_id || (item.quantity || 0) <= 0) continue
        await adjustStock(tx, {
          productId: item.product_id,
          delta: item.quantity,
          reason: 'LEND_DELETED',
          actor,
          referenceId: id,
          note: 'Lending record deleted; outstanding units returned to shelf',
        })
      }
    })

    return ok({ success: true })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: user.user_id, route: 'DELETE /api/lending/[id]' })
  }
}

// Two distinct operations shared one handler with no discriminator, so a body
// carrying both a status and a quantity silently did something no caller
// intended. They're now explicit, mutually exclusive shapes.
const returnItemSchema = z.object({
  action: z.literal('return').optional(),
  product_id: uuid,
  // The bug: this was entirely unvalidated and fed
  // `nowReturning = previousOutstanding - quantity`, so quantity: -999999
  // credited a million units to stock. It's the new outstanding balance, so
  // zero is valid and negative never is — the per-item ceiling is enforced
  // against the row below.
  quantity: nonNegativeQuantity,
  return_date: isoDateOnly.optional(),
})

const updateOrderSchema = z.object({
  action: z.literal('update-order').optional(),
  due_date: isoDateOnly.nullish(),
  return_date: isoDateOnly.nullish(),
})

export async function PUT(
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

    const order = await findVisibleOrder(scope, id)
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Lending record not found')

    // Discriminated on the presence of product_id *before* parsing, not by a
    // zod union. A union would try returnItemSchema, fail on a bad quantity,
    // then fall through to updateOrderSchema — whose fields are all optional,
    // so the malformed return parsed clean, took the order-update branch, and
    // silently succeeded as a no-op instead of reporting the bad input.
    const raw: unknown = await request.clone().json().catch(() => null)
    const isReturn = !!raw && typeof raw === 'object' && 'product_id' in raw

    if (isReturn) {
      const body = await parseBody(request, returnItemSchema)
      // The whole return flow — item update, stock credit, status recompute —
      // now runs in one transaction. It used to be four independent
      // statements, so a failure midway left a line item marked returned
      // whose stock was never credited back.
      await db.transaction((tx) => recordReturn(tx, id, body, actor))
      return ok({ success: true })
    }

    const body = await parseBody(request, updateOrderSchema)
    const orderUpdate: Partial<typeof lending_order.$inferInsert> = {}
    if (body.due_date !== undefined) orderUpdate.due_date = body.due_date ?? null
    if (body.return_date !== undefined) orderUpdate.return_date = body.return_date ?? null

    // `status` is deliberately absent from updateOrderSchema. It used to be
    // written straight from the request body into the enum column, letting a
    // client jump an order to RETURNED without returning anything or to LOST
    // with no stock adjustment. Status is derived from the line items now,
    // in recordReturn below, and is not client-settable.
    if (Object.keys(orderUpdate).length > 0) {
      await db.update(lending_order).set(orderUpdate).where(eq(lending_order.lending_order_id, id))
    }

    return ok({ success: true })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: user.user_id, route: 'PUT /api/lending/[id]' })
  }
}

async function recordReturn(
  tx: Tx,
  orderId: string,
  body: z.infer<typeof returnItemSchema>,
  actor: Actor,
) {
  const { product_id, quantity, return_date } = body

  // FOR UPDATE so two concurrent returns of the same line can't both read the
  // same outstanding balance and each credit stock for it.
  const [currentItem] = await tx
    .select({
      quantity: lending_item.quantity,
      item_type: lending_item.item_type,
      damaged_quantity: lending_item.damaged_quantity,
      lost_quantity: lending_item.lost_quantity,
    })
    .from(lending_item)
    .where(and(eq(lending_item.lend_order_id, orderId), eq(lending_item.product_id, product_id)))
    .for('update')

  if (!currentItem) throw new ApiError(404, 'NOT_FOUND', 'That product is not part of this lending record')
  if (currentItem.item_type !== 'RETURNABLE') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only returnable items can be marked returned')
  }

  const previousOutstanding = currentItem.quantity ?? 0
  if (quantity > previousOutstanding) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Outstanding quantity is ${previousOutstanding}; it cannot be raised to ${quantity}.`,
    )
  }

  const nowReturning = previousOutstanding - quantity

  await tx
    .update(lending_item)
    .set({ quantity, status: quantity === 0 ? 'RETURNED' : 'ISSUED' })
    .where(and(eq(lending_item.lend_order_id, orderId), eq(lending_item.product_id, product_id)))

  if (nowReturning > 0) {
    await adjustStock(tx, {
      productId: product_id,
      delta: nowReturning,
      reason: 'LEND_RETURNED',
      actor,
      referenceId: orderId,
      note: `${nowReturning} unit(s) returned`,
    })
  }

  // Status is recomputed from the line items rather than accepted from the
  // client, so it can never disagree with them.
  const allItems = await tx
    .select({
      quantity: lending_item.quantity,
      damaged_quantity: lending_item.damaged_quantity,
      lost_quantity: lending_item.lost_quantity,
    })
    .from(lending_item)
    .where(eq(lending_item.lend_order_id, orderId))

  const totalOutstanding = allItems.reduce((sum, item) => sum + (item.quantity || 0), 0)
  const anyDamaged = allItems.some((item) => (item.damaged_quantity || 0) > 0)
  const anyLost = allItems.some((item) => (item.lost_quantity || 0) > 0)

  const orderUpdate: Partial<typeof lending_order.$inferInsert> = {}

  if (totalOutstanding > 0) {
    orderUpdate.status = anyDamaged ? 'PARTIALLY_DAMAGED' : anyLost ? 'PARTIALLY_LOST' : 'PARTIALLY_RETURNED'
  } else {
    orderUpdate.status = anyDamaged ? 'RETURNED_DAMAGED' : anyLost ? 'RETURNED_LOST' : 'RETURNED'
    orderUpdate.return_date = return_date ?? new Date().toISOString().slice(0, 10)
  }

  await tx.update(lending_order).set(orderUpdate).where(eq(lending_order.lending_order_id, orderId))
}
