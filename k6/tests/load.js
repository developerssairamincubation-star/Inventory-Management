// LOAD — expected peak traffic, held long enough to be believable.
//
// This is the run whose numbers you quote. It answers: at the load we
// actually expect, does the app stay inside its SLO?
//
// Shape: ramp up (so connection pools and JIT warm), hold, ramp down. The
// hold is where the measurement lives; k6 reports the whole run, so keep the
// ramps short relative to the plateau.
//
//   PERF_VUS=50 PERF_DURATION=10m PERF_ALLOW_WRITES=true k6 run k6/tests/load.js
//
// Sizing: VUs are concurrent *users*, not requests/sec. With 1-4s think time
// each VU makes roughly 0.3-0.5 business actions/sec. 50 VUs ~= 20 actions/sec
// ~= 60-100 HTTP requests/sec, since one action is several requests.

import { sharedSetup, runIteration, sharedTeardown } from '../lib/scenario.js'
import { thresholds, num, env } from '../lib/config.js'

const VUS = num('PERF_VUS', 50)
const DURATION = env('PERF_DURATION', '10m')
const RAMP = env('PERF_RAMP', '2m')

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds,
  // Report percentiles that matter for a user-facing app; the default set
  // stops at p95 and hides the tail where the pool exhaustion lives.
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
