// STRESS — push past expected peak in steps until something gives, then keep
// going a little further, then recover.
//
// The output you want is not a pass/fail. It is the step at which p95 turns
// upward and errors appear, and whether the app comes back cleanly when the
// load is removed. A stress test that "passes" was not aggressive enough.
//
//   PERF_ALLOW_WRITES=true k6 run k6/tests/stress.js
//   PERF_STEP=100 PERF_STEPS=6 k6 run k6/tests/stress.js
//
// Where this app is expected to break, in roughly this order:
//   1. PGPOOL_MAX (default 10, src/db/client.ts) — requests queue for a
//      connection long before Postgres itself is busy. This is usually the
//      first wall, and it is a config change, not a code change.
//   2. GET /api/dashboard/stats and GET /api/lending — both load their whole
//      result set into Node and reduce it in JavaScript, so they burn event
//      loop time that every other request is waiting on.
//   3. PG_STATEMENT_TIMEOUT_MS (15s) — once queries queue past it, requests
//      start failing rather than just slowing.

import { sharedSetup, runIteration, sharedTeardown } from '../lib/scenario.js'
import { num, env } from '../lib/config.js'

const STEP = num('PERF_STEP', 50)
const STEPS = num('PERF_STEPS', 5)
const HOLD = env('PERF_HOLD', '3m')
const RAMP = env('PERF_STEP_RAMP', '1m')

const stages = []
for (let i = 1; i <= STEPS; i++) {
  stages.push({ duration: RAMP, target: STEP * i })
  stages.push({ duration: HOLD, target: STEP * i })
}
// Back to a light load rather than to zero: recovery is part of the result.
// An app that survives the peak but never drains its queue afterwards has
// failed, and ramping straight to 0 hides that.
stages.push({ duration: '1m', target: Math.max(1, Math.round(STEP / 5)) })
stages.push({ duration: '3m', target: Math.max(1, Math.round(STEP / 5)) })
stages.push({ duration: '30s', target: 0 })

export const options = {
  scenarios: {
    stress: { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '30s' },
  },
  // Loose on purpose. Degradation IS the finding; a hard threshold here just
  // aborts the run before it tells you where the wall is. The only strict one
  // is the rate limiter, because a 429 means you measured the wrong thing.
  thresholds: {
    rate_limited: ['count<1'],
    http_req_failed: ['rate<0.25'],
    'http_req_duration{endpoint:health}': ['p(99)<5000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function setup() {
  return sharedSetup()
}

export default function (state) {
  runIteration(state)
}

export function teardown(state) {
  sharedTeardown(state)
}
