// The only sanctioned way to change stocks.quantity.
//
// Two problems this replaces.
//
// 1. Every stock path was a read-then-write with no lock. Routes read a
//    quantity, computed a new absolute value in JavaScript, then wrote that
//    absolute back — sometimes with the read outside the transaction that
//    performed the write. Two operators acting at the same moment both read
//    10 and both wrote 8: one decrement vanished, with no error and no trace.
//    Every mutation here takes the row with SELECT ... FOR UPDATE first, so
//    concurrent callers serialise instead of overwriting each other.
//
// 2. `Math.max(0, current - n)` was used as the guard against negative stock.
//    That is not a guard, it is a silent data-loss clamp: over-issuing 500
//    units of a product with 3 in stock wrote 0 and lost the 497-unit
//    discrepancy permanently. Worse, with an unvalidated negative `n` the
//    same expression *added* stock. Underflow is now a rejected request.
//
// The model: stocks.quantity is what is physically on the shelf right now.
// Issuing a loan takes units off the shelf; returning puts them back. Marking
// an item damaged or lost does NOT touch quantity — those units already left
// the shelf when they were issued, and decrementing again (which the old
// damage/lost routes did) double-counted them out of existence.

import { eq, sql } from 'drizzle-orm'
import type { DbOrTx, Tx } from '@/db/client'
import { stocks, products, stock_ledger, type StockLedgerReason } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'

export type Actor = {
  userId: string
  email: string
  requestId?: string | null
}

type AdjustArgs = {
  productId: string
  /** Signed. Negative removes from the shelf, positive returns to it. */
  delta: number
  reason: StockLedgerReason
  actor: Actor
  referenceId?: string | null
  note?: string | null
  /**
   * Create a zero-quantity stocks row first if the product has none.
   *
   * Products created through POST /api/products always get one, but rows
   * predating that (or imported directly) may not, and the invoice restock
   * path used to paper over this with an upsert. Only meaningful for a
   * positive delta — you cannot take stock off a shelf that was never there.
   */
  createIfMissing?: boolean
}

/** A uuid column rejects a non-uuid string; middleware always supplies a real one. */
function normalizeRequestId(requestId?: string | null): string | null {
  if (!requestId) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ? requestId : null
}

/**
 * Locks a product's stock row for the rest of the transaction and returns its
 * current quantity. Call this before any read-modify-write on stock that this
 * module doesn't already perform for you.
 *
 * Must be called inside a transaction — FOR UPDATE outside one releases the
 * lock the instant the statement finishes, which is the same race it was
 * meant to prevent.
 */
export async function lockStock(tx: Tx, productId: string): Promise<{ quantity: number; damaged: number; lost: number }> {
  const [row] = await tx
    .select({
      quantity: stocks.quantity,
      damaged_quantity: stocks.damaged_quantity,
      lost_quantity: stocks.lost_quantity,
    })
    .from(stocks)
    .where(eq(stocks.product_id, productId))
    .for('update')

  if (!row) throw new ApiError(404, 'NOT_FOUND', 'No stock record exists for this product')
  return { quantity: row.quantity ?? 0, damaged: row.damaged_quantity ?? 0, lost: row.lost_quantity ?? 0 }
}

/**
 * Applies a signed change to a product's shelf quantity, writing an audit
 * entry in the same transaction. Rejects an adjustment that would take the
 * balance below zero, naming the actual shortfall — the caller can show the
 * operator a real number instead of silently clamping.
 */
export async function adjustStock(tx: Tx, args: AdjustArgs): Promise<number> {
  const { productId, delta, reason, actor, referenceId = null, note = null, createIfMissing = false } = args

  if (!Number.isInteger(delta)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Stock adjustment must be a whole number')
  }

  if (createIfMissing && delta > 0) {
    // ON CONFLICT DO NOTHING keeps this safe under concurrency: whichever
    // transaction gets there first creates the row, the other proceeds to
    // lock it.
    await tx.insert(stocks).values({ product_id: productId, quantity: 0 }).onConflictDoNothing()
  }

  if (delta === 0) {
    const { quantity } = await lockStock(tx, productId)
    return quantity
  }

  const current = await lockStock(tx, productId)
  const next = current.quantity + delta

  if (next < 0) {
    throw new ApiError(
      409,
      'INSUFFICIENT_STOCK',
      `Only ${current.quantity} unit(s) available — ${Math.abs(delta)} requested.`,
      { available: current.quantity, requested: Math.abs(delta) },
    )
  }

  await tx.update(stocks).set({ quantity: next }).where(eq(stocks.product_id, productId))

  await writeLedgerEntry(tx, { productId, delta, quantityAfter: next, reason, actor, referenceId, note })

  return next
}

/**
 * Sets shelf quantity to an exact figure — a stocktake correction, not a
 * movement. Separate from adjustStock because the audit entry means something
 * different: the delta is derived, not requested.
 */
export async function setStock(
  tx: Tx,
  args: { productId: string; quantity: number; actor: Actor; note?: string | null },
): Promise<number> {
  const { productId, quantity, actor, note = null } = args

  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Stock quantity must be a whole number of zero or more')
  }

  const current = await lockStock(tx, productId)
  if (current.quantity === quantity) return quantity

  await tx.update(stocks).set({ quantity }).where(eq(stocks.product_id, productId))

  await writeLedgerEntry(tx, {
    productId,
    delta: quantity - current.quantity,
    quantityAfter: quantity,
    reason: 'MANUAL_ADJUSTMENT',
    actor,
    referenceId: null,
    note: note ?? `Corrected from ${current.quantity} to ${quantity}`,
  })

  return quantity
}

/**
 * Records units as damaged or lost while out on loan.
 *
 * Deliberately does not touch stocks.quantity. Those units were removed from
 * the shelf when the loan was issued and never came back — the old routes
 * decremented quantity a second time here, so every loss was counted out of
 * inventory twice, and the dashboard then added it back once as
 * `available + lent + damaged + lost`. A ledger entry with a zero delta is
 * still written, because "these units are never coming back" is exactly the
 * kind of event an audit trail exists to record.
 */
export async function recordWriteOff(
  tx: Tx,
  args: {
    productId: string
    quantity: number
    kind: 'damaged' | 'lost'
    actor: Actor
    referenceId?: string | null
  },
): Promise<{ damaged: number; lost: number; quantity: number }> {
  const { productId, quantity, kind, actor, referenceId = null } = args

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Write-off quantity must be a positive whole number')
  }

  const current = await lockStock(tx, productId)

  await tx
    .update(stocks)
    .set(
      kind === 'damaged'
        ? { damaged_quantity: sql`${stocks.damaged_quantity} + ${quantity}` }
        : { lost_quantity: sql`${stocks.lost_quantity} + ${quantity}` },
    )
    .where(eq(stocks.product_id, productId))

  await writeLedgerEntry(tx, {
    productId,
    delta: 0,
    quantityAfter: current.quantity,
    reason: kind === 'damaged' ? 'MARKED_DAMAGED' : 'MARKED_LOST',
    actor,
    referenceId,
    note: `${quantity} unit(s) marked ${kind} while on loan (already off-shelf; shelf quantity unchanged)`,
  })

  return {
    quantity: current.quantity,
    damaged: kind === 'damaged' ? current.damaged + quantity : current.damaged,
    lost: kind === 'lost' ? current.lost + quantity : current.lost,
  }
}

/**
 * Records an event that belongs in the audit trail but doesn't change the
 * shelf count — a full transfer, where ownership moves and the quantity rides
 * along with it. adjustStock's zero-delta path deliberately writes nothing,
 * so this is the explicit way to say "nothing moved, but note that this
 * happened".
 */
export async function recordStockEvent(
  tx: Tx,
  args: { productId: string; reason: StockLedgerReason; actor: Actor; referenceId?: string | null; note?: string | null },
): Promise<void> {
  const current = await lockStock(tx, args.productId)
  await writeLedgerEntry(tx, {
    productId: args.productId,
    delta: 0,
    quantityAfter: current.quantity,
    reason: args.reason,
    actor: args.actor,
    referenceId: args.referenceId ?? null,
    note: args.note ?? null,
  })
}

/** Creates the stocks row for a brand-new product, with its opening ledger entry. */
export async function openStock(
  tx: Tx,
  args: { productId: string; quantity: number; location: string | null; actor: Actor },
): Promise<{ quantity: number; location: string | null }> {
  const { productId, quantity, location, actor } = args

  const [row] = await tx.insert(stocks).values({ product_id: productId, quantity, location }).returning()

  await writeLedgerEntry(tx, {
    productId,
    delta: quantity,
    quantityAfter: quantity,
    reason: 'PRODUCT_CREATED',
    actor,
    referenceId: null,
    note: 'Opening balance',
  })

  return { quantity: row.quantity, location: row.location }
}

async function writeLedgerEntry(
  tx: Tx,
  args: {
    productId: string
    delta: number
    quantityAfter: number
    reason: StockLedgerReason
    actor: Actor
    referenceId: string | null
    note: string | null
  },
) {
  // Denormalised so the entry stays readable after the product is deleted —
  // the FK is ON DELETE SET NULL precisely so history survives.
  const [product] = await tx
    .select({ product_name: products.product_name })
    .from(products)
    .where(eq(products.product_id, args.productId))

  await tx.insert(stock_ledger).values({
    product_id: args.productId,
    product_name: product?.product_name ?? 'Unknown product',
    reason: args.reason,
    quantity_delta: args.delta,
    quantity_after: args.quantityAfter,
    actor_user_id: args.actor.userId,
    actor_email: args.actor.email,
    request_id: normalizeRequestId(args.actor.requestId),
    reference_id: args.referenceId,
    note: args.note,
  })
}

/** Builds the Actor a route passes into every call here. */
export function actorFrom(
  user: { user_id: string; email: string },
  requestId?: string | null,
): Actor {
  return { userId: user.user_id, email: user.email, requestId }
}

export type { DbOrTx }
