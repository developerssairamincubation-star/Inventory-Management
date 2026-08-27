// Read-heavy flows — what staff actually do most of the time: open the
// dashboard, scroll the stock list, check who has what out on loan.
//
// These are the flows that matter most for capacity, and they are also where
// this app's known scaling cliffs are:
//
//  - GET /api/dashboard/stats loads EVERY product and EVERY lending order the
//    caller can see into Node and reduces them in JavaScript. Cost grows
//    linearly with catalogue size, not with page size.
//  - GET /api/lending has no LIMIT at all — it returns every order in the
//    period plus every line item.
//  - GET /api/invoices likewise has no LIMIT.
//
// Each is tagged separately so a run tells you which one gave out first.

import { get, json } from '../lib/session.js'
import { flowDuration, flowSuccess } from '../lib/metrics.js'
import { pick, randInt } from '../lib/data.js'

const PERIODS = ['daily', 'weekly', 'monthly', 'yearly']

/** Landing on /dashboard — the fan-out a single page load actually makes. */
export function dashboardFlow() {
  const started = Date.now()
  const period = pick(PERIODS)

  const responses = [
    get('/api/auth/me', { endpoint: 'auth_me', flow: 'dashboard' }),
    get('/api/dashboard/stats', { endpoint: 'dashboard_stats', flow: 'dashboard' }),
    get(`/api/dashboard/analytics?period=${period}`, { endpoint: 'dashboard_analytics', flow: 'dashboard' }),
    get('/api/dashboard/overdue', { endpoint: 'dashboard_overdue', flow: 'dashboard' }),
    get(`/api/dashboard/top-lent?period=${period}`, { endpoint: 'dashboard_top_lent', flow: 'dashboard' }),
  ]

  const success = responses.every((r) => r.status === 200)
  flowDuration.add(Date.now() - started, { flow: 'dashboard' })
  flowSuccess.add(success, { flow: 'dashboard' })
  return success
}

/** Stock List page: a paged product read plus the reference data the filters need. */
export function browseFlow(state) {
  const started = Date.now()

  // Paging deeper than page 1 on purpose — OFFSET pagination degrades with
  // depth, and a test that only ever reads offset=0 never shows it.
  const offset = randInt(0, 4) * 50
  const products = get(`/api/products?limit=50&offset=${offset}`, {
    endpoint: 'products_list',
    flow: 'browse',
  })

  const refs = [
    get('/api/categories', { endpoint: 'categories_list', flow: 'browse' }),
    get('/api/coe-domains', { endpoint: 'domains_list', flow: 'browse' }),
  ]

  // Half of visits also open the lending or invoice tab.
  const secondary =
    Math.random() < 0.5
      ? get(`/api/lending?period=${pick(PERIODS)}`, { endpoint: 'lending_list', flow: 'browse' })
      : get('/api/invoices', { endpoint: 'invoices_list', flow: 'browse' })

  // Keep the shared product pool warm so later iterations have real ids to
  // read and lend against, rather than reusing setup()'s snapshot forever.
  const body = json(products)
  if (state && Array.isArray(body) && body.length) {
    state.products = body
      .filter((p) => p && p.product_id)
      .slice(0, 50)
      .map((p) => ({ product_id: p.product_id, sku_code: p.sku_code, product_name: p.product_name }))
  }

  const success = products.status === 200 && refs.every((r) => r.status === 200) && secondary.status === 200
  flowDuration.add(Date.now() - started, { flow: 'browse' })
  flowSuccess.add(success, { flow: 'browse' })
  return success
}

/** Opening one product — includes the transfer-history join added in V28. */
export function productDetailFlow(state) {
  const pool = (state && state.products) || []
  if (!pool.length) return browseFlow(state)

  const started = Date.now()
  const target = pick(pool)

  const detail = get(`/api/products/${target.product_id}`, {
    endpoint: 'product_detail',
    flow: 'product_detail',
    allow404: true, // another VU's transfer/delete may have moved it
  })

  // The barcode-scan path: exact SKU lookup, a different query plan entirely.
  let scan = { status: 200 }
  if (target.sku_code) {
    scan = get(`/api/products?sku=${encodeURIComponent(target.sku_code)}`, {
      endpoint: 'product_scan_sku',
      flow: 'product_detail',
      allow404: true,
    })
  }

  const success = detail.status < 500 && scan.status < 500
  flowDuration.add(Date.now() - started, { flow: 'product_detail' })
  flowSuccess.add(success, { flow: 'product_detail' })
  return success
}

/** Students page: search-as-you-type against a LIKE query. */
export function studentSearchFlow() {
  const started = Date.now()
  const term = pick(['a', 'sit', 'k6', 'cs', '21', 'stu'])

  const responses = [
    get(`/api/students?search=${term}&limit=50`, { endpoint: 'students_list', flow: 'students' }),
    get(`/api/students/records?period=${pick(PERIODS)}`, { endpoint: 'student_records', flow: 'students' }),
  ]

  const success = responses.every((r) => r.status === 200)
  flowDuration.add(Date.now() - started, { flow: 'students' })
  flowSuccess.add(success, { flow: 'students' })
  return success
}
