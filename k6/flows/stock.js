// Product creation and stock adjustment.
//
// POST /api/products allocates a SKU from a shared sequence
// (src/lib/idSequences.ts allocateNextSkuCode) inside the same transaction
// that inserts the product — so concurrent creates in the SAME category all
// contend on one sequence row. That is the interesting contention here, and
// it is why the flow deliberately reuses one category rather than spreading
// across many.
//
// PATCH /api/products/[id]/update-stock has two distinct paths worth
// exercising separately: a relative top-up (additionalStock) and an absolute
// stocktake correction (newStock). Both take a row lock; the second is the
// one that overwrites concurrent work by design.

import { get, post, patch, json } from '../lib/session.js'
import { flowDuration, flowSuccess, rowsCreated } from '../lib/metrics.js'
import { pick, randInt, productName, money } from '../lib/data.js'

export function stockFlow(state) {
  const started = Date.now()

  // The UI previews the next SKU before the form is submitted.
  const categoryId = state.categoryId
  const preview = get(
    categoryId ? `/api/products/next-sku?category_id=${categoryId}` : '/api/products/next-sku',
    { endpoint: 'next_sku', flow: 'stock' },
  )

  const createRes = post(
    '/api/products',
    {
      product_name: productName(),
      unit_cost: money(100, 25000),
      quantity: randInt(5, 200),
      description: 'Created by the k6 performance suite.',
      category_id: categoryId || null,
      location: pick(['Rack A', 'Rack B', 'Store Room', 'Lab 1']),
    },
    { endpoint: 'product_create', flow: 'stock' },
  )

  const created = json(createRes)
  let adjusted = true

  if (created && created.product) {
    rowsCreated.add(1, { table: 'products' })
    const id = created.product.product_id

    // Keep the pools fresh so later iterations read and adjust recent rows.
    // Products created here carry the k6- prefix, so they are safe to write to.
    const row = {
      product_id: id,
      sku_code: created.product.sku_code,
      product_name: created.product.product_name,
    }
    // Readable, but NOT lendable: products created here carry a small starting
    // quantity, and adding them to the lending pool is what let a long run
    // drain its own inventory and then measure 409s. Lending stays on the
    // 1,000,000-unit fixtures from sharedSetup.
    if (state.products && state.products.length < 200) state.products.push(row)

    const res =
      Math.random() < 0.7
        ? patch(`/api/products/${id}/update-stock`, { additionalStock: randInt(1, 50) }, {
            endpoint: 'stock_topup',
            flow: 'stock',
          })
        : patch(`/api/products/${id}/update-stock`, { newStock: randInt(0, 500) }, {
            endpoint: 'stock_correct',
            flow: 'stock',
          })
    adjusted = res.status === 200
  }

  const success = preview.status === 200 && createRes.status === 201 && adjusted
  flowDuration.add(Date.now() - started, { flow: 'stock' })
  flowSuccess.add(success, { flow: 'stock' })
  return success
}

/**
 * Restock-only variant: no new products, just concurrent adjustments against
 * the existing pool. Use this for a soak run, where creating a product per
 * iteration would grow the catalogue (and therefore every unbounded dashboard
 * query) throughout the test and make the results non-comparable.
 */
export function restockFlow(state) {
  // Fixtures only — same reasoning as lendingFlow.
  const pool = (state && state.lendable) || []
  if (!pool.length) return false

  const started = Date.now()
  const target = pick(pool)

  const res = patch(
    `/api/products/${target.product_id}/update-stock`,
    { additionalStock: randInt(1, 20) },
    { endpoint: 'stock_topup', flow: 'restock', allow404: true },
  )

  const success = res.status < 400
  flowDuration.add(Date.now() - started, { flow: 'restock' })
  flowSuccess.add(success, { flow: 'restock' })
  return success
}
