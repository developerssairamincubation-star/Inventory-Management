// Shared implementation behind POST /api/lending/[id]/damage and
// POST /api/lending/[id]/lost.
//
// The two routes were near-identical copies, and both carried the same three
// defects:
//
//  1. They read lending_item and stocks *outside* the transaction, computed
//     absolute new values in JavaScript, then wrote those absolutes inside
//     it. Two concurrent write-offs both read the same balance and the second
//     overwrote the first — one loss silently disappeared.
//
//  2. They decremented stocks.quantity. Those units had already left the
//     shelf when the loan was issued, so every loss was counted out of stock
//     twice; the dashboard then added it back once as
//     `available + lent + damaged + lost`, drifting the totals further.
//
//  3. `damaged_quantity` / `lost_quantity` arrived unvalidated. `!quantity`
//     rejected 0 but a string, a float, or a huge value all passed.

import { and, eq } from 'drizzle-orm'
import { db, type Tx } from '@/db/client'
import { lending_order, lending_item } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { lendingScope, type Scope } from '@/lib/authz'
import { recordWriteOff, type Actor } from '@/lib/stock'

export type WriteOffKind = 'damaged' | 'lost'

export type WriteOffResult = {
  success: true
  newLentQuantity: number
  newStockQuantity: number
  newDamagedQuantity: number
  newLostQuantity: number
  orderStatus: string
}

export async function applyWriteOff(args: {
  scope: Scope
  actor: Actor
  orderId: string
  productId: string
  quantity: number
  kind: WriteOffKind
}): Promise<WriteOffResult> {
  const { scope, actor, orderId, productId, quantity, kind } = args

  return db.transaction(async (tx) => {
    // Throws 404 if the caller may not touch this order — loaded for the
    // authorization check, not for its columns.
    await loadOrderForUpdate(tx, scope, orderId)

    // FOR UPDATE: serialises concurrent write-offs against the same line.
    const [item] = await tx
      .select({
        quantity: lending_item.quantity,
        original_quantity: lending_item.original_quantity,
        damaged_quantity: lending_item.damaged_quantity,
        lost_quantity: lending_item.lost_quantity,
        item_type: lending_item.item_type,
      })
      .from(lending_item)
      .where(and(eq(lending_item.lend_order_id, orderId), eq(lending_item.product_id, productId)))
      .for('update')

    if (!item) throw new ApiError(404, 'NOT_FOUND', 'That product is not part of this lending record')
    if (item.item_type !== 'RETURNABLE') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Consumable items can't be marked ${kind}`)
    }

    const outstanding = item.quantity ?? 0
    if (quantity > outstanding) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `${kind === 'damaged' ? 'Damaged' : 'Lost'} quantity (${quantity}) exceeds the ${outstanding} unit(s) still outstanding.`,
      )
    }

    const newOutstanding = outstanding - quantity
    const newDamaged = (item.damaged_quantity ?? 0) + (kind === 'damaged' ? quantity : 0)
    const newLost = (item.lost_quantity ?? 0) + (kind === 'lost' ? quantity : 0)

    await tx
      .update(lending_item)
      .set({
        quantity: newOutstanding,
        ...(kind === 'damaged' ? { damaged_quantity: newDamaged } : { lost_quantity: newLost }),
      })
      .where(and(eq(lending_item.lend_order_id, orderId), eq(lending_item.product_id, productId)))

    // Increments the damaged/lost counter and writes an audit entry, but
    // deliberately leaves stocks.quantity alone — see the file header.
    const stock = await recordWriteOff(tx, { productId, quantity, kind, actor, referenceId: orderId })

    const status = await recomputeOrderStatus(tx, orderId)

    return {
      success: true as const,
      newLentQuantity: newOutstanding,
      newStockQuantity: stock.quantity,
      newDamagedQuantity: stock.damaged,
      newLostQuantity: stock.lost,
      orderStatus: status,
    }
  })
}

async function loadOrderForUpdate(tx: Tx, scope: Scope, orderId: string) {
  const visible = lendingScope(scope)
  const [order] = await tx
    .select({ lending_order_id: lending_order.lending_order_id })
    .from(lending_order)
    .where(visible ? and(eq(lending_order.lending_order_id, orderId), visible) : eq(lending_order.lending_order_id, orderId))

  if (!order) throw new ApiError(404, 'NOT_FOUND', 'Lending record not found')
  return order
}

/**
 * Derives the order's status from its line items.
 *
 * The old routes set status from a partial view — the damage route only ever
 * promoted PENDING, so an order that had already been marked partially lost
 * stayed PARTIALLY_LOST after damage was recorded too. Recomputing from the
 * items means the status always agrees with them.
 */
async function recomputeOrderStatus(tx: Tx, orderId: string): Promise<string> {
  const items = await tx
    .select({
      quantity: lending_item.quantity,
      damaged_quantity: lending_item.damaged_quantity,
      lost_quantity: lending_item.lost_quantity,
    })
    .from(lending_item)
    .where(eq(lending_item.lend_order_id, orderId))

  const outstanding = items.reduce((sum, i) => sum + (i.quantity || 0), 0)
  const anyDamaged = items.some((i) => (i.damaged_quantity || 0) > 0)
  const anyLost = items.some((i) => (i.lost_quantity || 0) > 0)

  let status: typeof lending_order.$inferInsert.status
  if (outstanding > 0) {
    status = anyDamaged ? 'PARTIALLY_DAMAGED' : anyLost ? 'PARTIALLY_LOST' : 'PARTIALLY_RETURNED'
  } else if (anyDamaged && anyLost) {
    status = 'RETURNED_DAMAGED'
  } else if (anyDamaged) {
    status = 'DAMAGED'
  } else if (anyLost) {
    status = 'LOST'
  } else {
    status = 'RETURNED'
  }

  await tx.update(lending_order).set({ status }).where(eq(lending_order.lending_order_id, orderId))
  return status
}
