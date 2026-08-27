// Issue-and-return, the app's busiest write path and the one with real
// contention: POST /api/lending runs one transaction that get-or-creates a
// student, validates every product against the caller's COE scope, and takes
// a row lock per product to decrement stock (src/lib/stock.ts adjustStock).
//
// Concurrency here is the point. Many VUs lending the SAME product is the
// interesting case — it serialises on the stock row lock, and that is exactly
// what a real scan-and-issue queue at a counter looks like. HOT_PRODUCTS
// controls how narrow that contention is.

import { get, post, json } from '../lib/session.js'
import { flowDuration, flowSuccess, rowsCreated } from '../lib/metrics.js'
import { pick, randInt, studentIdCode, studentName, futureDate } from '../lib/data.js'
import { authFetch } from '../lib/session.js'
import { num } from '../lib/config.js'

/**
 * How many distinct products the lending flow draws from. A small number
 * concentrates every VU on the same stock rows, which is the lock-contention
 * scenario; a large number spreads the load out. Default is deliberately
 * narrow — the pessimistic case is the one worth measuring.
 */
const HOT_PRODUCTS = num('PERF_HOT_PRODUCTS', 5)

export function lendingFlow(state) {
  // `lendable`, not `products`: issuing a loan decrements real stock, so the
  // flow only ever touches fixtures the suite created (see sharedSetup).
  const pool = (state && state.lendable) || []
  if (!pool.length) return false

  const started = Date.now()
  const deptCode = pick(state.departmentCodes)
  const code = studentIdCode(deptCode, state.studentPoolSize)

  // 1. Scan the student card. POST, so it needs CSRF and counts against the
  //    mutation limit (120/min) even though it only reads.
  const decoded = post('/api/students/decode', { student_id_code: code }, {
    endpoint: 'student_decode',
    flow: 'lending',
  })

  // 2. Scan the item barcode -> exact SKU lookup.
  const hot = pool.slice(0, Math.min(HOT_PRODUCTS, pool.length))
  const target = pick(hot)
  if (target.sku_code) {
    get(`/api/products?sku=${encodeURIComponent(target.sku_code)}`, {
      endpoint: 'product_scan_sku',
      flow: 'lending',
    })
  }

  // 3. Issue. quantity stays small so a long run does not drain stock to zero
  //    and turn every later iteration into a 409/validation path.
  const payload = {
    lending_items: [
      { product_id: target.product_id, quantity: randInt(1, 2), item_type: 'RETURNABLE' },
    ],
    student_id_code: code,
    student_name: studentName(code),
    due_date: futureDate(randInt(3, 21)),
  }
  // Only a super_admin with no COE of their own may name the domain; a
  // domain-assigned user always lends for their own COE and the server
  // ignores/rejects an override.
  if (state.domainId && state.isSuperAdmin) payload.domain_id = state.domainId

  const createRes = post('/api/lending', payload, {
    endpoint: 'lending_create',
    flow: 'lending',
    // 404 is legitimate under concurrency: another VU may have transferred
    // the product out of this caller's scope mid-run.
    allow404: true,
  })

  const created = json(createRes)
  let returned = true

  // 4. Return it again, most of the time — otherwise a soak run accumulates
  //    open loans forever and the dashboard's overdue query grows unbounded.
  if (created && created.order && Math.random() < 0.7) {
    rowsCreated.add(1, { table: 'lending_order' })
    const res = authFetch(
      'PUT',
      `/api/lending/${created.order.lending_order_id}`,
      // quantity is the NEW outstanding balance, not the amount handed back:
      // 0 means fully returned. Getting this backwards silently credits stock.
      { product_id: target.product_id, quantity: 0 },
      { endpoint: 'lending_return', flow: 'lending' },
    )
    returned = res.status === 200
  } else if (created && created.order) {
    rowsCreated.add(1, { table: 'lending_order' })
  }

  const success = decoded.status === 200 && createRes.status < 400 && returned
  flowDuration.add(Date.now() - started, { flow: 'lending' })
  flowSuccess.add(success, { flow: 'lending' })
  return success
}
