// SMOKE — 1 VU, one pass through every flow.
//
// Not a performance test. It answers "is the script correct and is the target
// wired up?" before you spend 30 minutes on a soak. Run it first, every time,
// and especially after changing an API contract: a flow that silently 403s on
// CSRF still produces a beautiful-looking load report.
//
//   k6 run k6/tests/smoke.js
//   PERF_ALLOW_WRITES=true k6 run k6/tests/smoke.js

import { sharedSetup, sharedTeardown } from '../lib/scenario.js'
import { ensureSession } from '../lib/session.js'
import { dashboardFlow, browseFlow, productDetailFlow, studentSearchFlow } from '../flows/browse.js'
import { lendingFlow } from '../flows/lending.js'
import { stockFlow, restockFlow } from '../flows/stock.js'
import { invoiceFlow } from '../flows/invoice.js'

export const options = {
  vus: 1,
  iterations: 1,
  // Strict: at one VU there is no excuse for a failure or a slow response.
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<3000'],
    flow_success: ['rate==1'],
  },
}

export function setup() {
  return sharedSetup()
}

export default function (state) {
  ensureSession()

  dashboardFlow()
  browseFlow(state)
  productDetailFlow(state)
  studentSearchFlow()

  if (state.allowWrites) {
    stockFlow(state)
    restockFlow(state)
    lendingFlow(state)
    invoiceFlow(state)
  } else {
    console.log('Write flows skipped — set PERF_ALLOW_WRITES=true to smoke-test them.')
  }
}

export function teardown(state) {
  sharedTeardown(state)
}
