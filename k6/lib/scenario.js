// Shared setup / iteration body / teardown for every test in k6/tests.
//
// The tests differ only in their `options` (how much load, in what shape).
// The work each VU does is identical, which is the whole point: a load run
// and a spike run must be comparable, and they only are if the traffic mix is
// literally the same code.

import { sleep } from 'k6'
import http from 'k6/http'
import exec from 'k6/execution'
import {
  BASE_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ALLOW_WRITES,
  MIX,
  THINK_MIN,
  THINK_MAX,
  RUN_ID,
  USER_COUNT,
  guardTarget,
  num,
} from './config.js'
import { ensureSession, get, post, json, jar, baseHeaders } from './session.js'
import { weightedPick, thinkTime } from './data.js'
import { dashboardFlow, browseFlow, productDetailFlow, studentSearchFlow } from '../flows/browse.js'
import { lendingFlow } from '../flows/lending.js'
import { stockFlow, restockFlow } from '../flows/stock.js'
import { invoiceFlow } from '../flows/invoice.js'

const STUDENT_POOL_SIZE = num('PERF_STUDENT_POOL', 200)
/** Products the suite creates in setup() when the target has too few to test with. */
const MIN_PRODUCTS = num('PERF_MIN_PRODUCTS', 10)

/**
 * Runs once before any VU starts. Everything it returns is copied into each
 * VU — note "copied": a VU mutating state.products only changes its own copy,
 * which is what we want (each VU keeps its own warm pool).
 */
export function sharedSetup() {
  guardTarget()

  // Health first. A failed load test against a half-booted app wastes a run
  // and looks like a performance problem.
  const health = http.get(`${BASE_URL}/api/health`, { tags: { endpoint: 'health', flow: 'setup' } })
  if (health.status !== 200) {
    exec.test.abort(`${BASE_URL}/api/health -> ${health.status}. Start the stack before running k6.`)
  }

  // setup() runs outside any VU, so it uses the admin account directly rather
  // than the per-VU pool. This is the only login the admin account performs.
  const identity = ensureSession()
  if (!identity) {
    exec.test.abort('Setup login failed. Check PERF_ADMIN_EMAIL / PERF_ADMIN_PASSWORD and that the account is active.')
  }

  // Login returning 200 is NOT proof the session works — it only proves the
  // credentials were right. The cookies still have to come back on the next
  // request, and there is one common way that fails:
  //
  //   src/lib/cookies.ts sets every auth cookie with `secure: isProd()`, and
  //   `npm run start` sets NODE_ENV=production. A Secure cookie is only sent
  //   over HTTPS, so a production build on plain http:// logs in fine and
  //   then 401s on everything after it.
  //
  // Without this probe the run continued with an empty product pool and
  // thousands of 401s, which reads as "the app is fast" rather than "nothing
  // was authenticated". Fail loudly instead.
  const me = get('/api/auth/me', { endpoint: 'auth_me', flow: 'setup' })
  if (me.status !== 200) {
    exec.test.abort(
      `Login succeeded but the session does not persist (GET /api/auth/me -> ${me.status}). ` +
        (BASE_URL.startsWith('http://')
          ? 'BASE_URL is plain HTTP against what looks like a production build — auth cookies are Secure and ' +
            'will never be sent back. Put TLS in front: node k6/tools/gen-cert.mjs && node k6/tools/tls-proxy.mjs, ' +
            'then BASE_URL=https://localhost:4443 k6 run --insecure-skip-tls-verify ...'
          : 'Check that cookies are being returned and that the clock/TLS settings are sane.'),
    )
  }

  const departments = json(get('/api/departments', { endpoint: 'departments_list', flow: 'setup' })) || []
  const domains = json(get('/api/coe-domains', { endpoint: 'domains_list', flow: 'setup' })) || []
  const categories = json(get('/api/categories', { endpoint: 'categories_list', flow: 'setup' })) || []

  // A student ID code decodes to a department CODE, and POST /api/lending
  // returns 422 UNKNOWN_DEPARTMENT for a code with no row. Generating codes
  // from real department rows is the difference between testing a transaction
  // and testing a validation rejection.
  const departmentCodes = departments.filter((d) => d && d.code).map((d) => String(d.code).toLowerCase())

  const products = (json(get('/api/products?limit=200', { endpoint: 'products_list', flow: 'setup' })) || [])
    .filter((p) => p && p.product_id)
    .map((p) => ({ product_id: p.product_id, sku_code: p.sku_code, product_name: p.product_name }))

  // The read flows may touch anything the account can see — that is realistic
  // and harmless. The WRITE flows must not: lending decrements stock and
  // restocking increments it, and the local Postgres here is a persistent dev
  // database with real inventory in it. So mutations are confined to products
  // the suite created and owns, identified by the 'k6-' name prefix, which is
  // also what k6/seed/cleanup.sql keys off.
  // Only the setup-created fixtures, not every k6- product.
  //
  // This used to accept any 'k6-' row, which quietly included the small-batch
  // products a previous run's stockFlow had created (quantity 5-200). Over a
  // 5-hour soak the lending flow drained those to zero and then spent the rest
  // of the run collecting correct-but-useless 409 INSUFFICIENT_STOCK
  // responses — 1,294 of them, which read as a 64% failure rate on
  // lending_create when the app was in fact behaving perfectly. Fixtures are
  // seeded at quantity 1,000,000 precisely so a long run cannot exhaust them.
  const FIXTURE_MARK = '-fixture-'
  const lendable = products.filter(
    (p) => String(p.product_name || '').startsWith('k6-') && String(p.product_name).includes(FIXTURE_MARK),
  )

  if (ALLOW_WRITES && lendable.length < MIN_PRODUCTS) {
    const categoryId = categories.length ? categories[0].category_id : null
    for (let i = lendable.length; i < MIN_PRODUCTS; i++) {
      const res = post(
        '/api/products',
        {
          product_name: `k6-${RUN_ID}-fixture-${i}`,
          unit_cost: 1000,
          // Large on purpose: a long run must not lend the fixture down to
          // zero and start measuring the out-of-stock rejection path instead
          // of the transaction.
          quantity: 1000000,
          category_id: categoryId,
          location: 'k6-fixture',
        },
        { endpoint: 'product_create', flow: 'setup' },
      )
      const body = json(res)
      if (body && body.product) {
        const row = {
          product_id: body.product.product_id,
          sku_code: body.product.sku_code,
          product_name: body.product.product_name,
        }
        lendable.push(row)
        products.push(row)
      }
    }
  }

  const state = {
    runId: RUN_ID,
    isSuperAdmin: identity.role === 'super_admin',
    departmentCodes: departmentCodes.length ? departmentCodes : ['cs'],
    domainId: domains.length ? domains[0].domain_id : null,
    categoryId: categories.length ? categories[0].category_id : null,
    products,
    // Write flows draw from here only — never from `products`.
    lendable,
    studentPoolSize: STUDENT_POOL_SIZE,
    allowWrites: ALLOW_WRITES,
  }

  console.log(
    `k6 setup: run=${RUN_ID} target=${BASE_URL} readable=${products.length} lendable=${lendable.length} ` +
      `deptCodes=${state.departmentCodes.join(',')} domain=${state.domainId ? 'yes' : 'none'} ` +
      `writes=${ALLOW_WRITES ? 'ON' : 'off'} userPool=${USER_COUNT || '1 (admin)'}`,
  )

  if (ALLOW_WRITES && !lendable.length) {
    exec.test.abort(
      'No k6-owned products to write against, and none could be created. ' +
        'The lending/restock flows would otherwise mutate real inventory.',
    )
  }

  if (!products.length) {
    console.warn(
      'No products visible to the setup account. Read flows will still run; lending/detail flows will be skipped. ' +
        'Run with PERF_ALLOW_WRITES=true to have setup seed some.',
    )
  }

  return state
}

/**
 * One VU iteration: log in on first pass, run one weighted business flow,
 * then think. `state` is this VU's mutable copy of setup()'s return value.
 */
export function runIteration(state) {
  if (!ensureSession()) {
    // A VU that cannot authenticate must not spin: it would generate
    // thousands of 401s and drown the real signal.
    sleep(5)
    return
  }

  const weights = state.allowWrites
    ? MIX
    : { browse: MIX.browse, productDetail: MIX.productDetail }

  switch (weightedPick(weights)) {
    case 'browse':
      // Two thirds of "browse" is the dashboard, which is the single most
      // expensive read in the app.
      if (Math.random() < 0.5) dashboardFlow()
      else if (Math.random() < 0.7) browseFlow(state)
      else studentSearchFlow()
      break
    case 'productDetail':
      productDetailFlow(state)
      break
    case 'lending':
      lendingFlow(state)
      break
    case 'stock':
      stockFlow(state)
      break
    case 'invoice':
      invoiceFlow(state)
      break
  }

  sleep(thinkTime(THINK_MIN, THINK_MAX))
}

/** Soak variant: no catalogue growth, so hour 1 and hour 3 stay comparable. */
export function runSoakIteration(state) {
  if (!ensureSession()) {
    sleep(5)
    return
  }

  const roll = Math.random()
  if (roll < 0.45) dashboardFlow()
  else if (roll < 0.7) browseFlow(state)
  else if (roll < 0.8) productDetailFlow(state)
  else if (roll < 0.9) studentSearchFlow()
  else if (state.allowWrites && roll < 0.96) lendingFlow(state)
  else if (state.allowWrites) restockFlow(state)
  else browseFlow(state)

  sleep(thinkTime(THINK_MIN, THINK_MAX))
}

export function sharedTeardown(state) {
  console.log(
    `k6 teardown: run=${state.runId}. ` +
      (state.allowWrites
        ? `Rows were created. Remove them with:\n` +
          `  psql "$DATABASE_URL" -v run_id="'${state.runId}'" -f k6/seed/cleanup.sql`
        : 'Read-only run — nothing to clean up.'),
  )
}

export { jar, baseHeaders }
