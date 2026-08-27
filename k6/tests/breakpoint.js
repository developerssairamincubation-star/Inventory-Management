// BREAKPOINT — find the ceiling, in requests/sec rather than in VUs.
//
// Uses an OPEN model (ramping-arrival-rate): k6 keeps issuing N iterations per
// second regardless of how slow the app gets, adding VUs as needed. The
// closed model every other test here uses (ramping-vus) cannot find a ceiling,
// because as the app slows each VU naturally issues fewer requests — the load
// backs off exactly when you want it not to. That is the right model for
// simulating real users with think time, and the wrong one for capacity.
//
// abortOnFail stops the run the moment the SLO breaks, so the last completed
// rate is the answer.
//
//   k6 run k6/tests/breakpoint.js
//   PERF_MAX_RPS=400 PERF_BREAK_DURATION=20m k6 run k6/tests/breakpoint.js
//
// Set preAllocatedVUs high enough that k6 itself is never the bottleneck; if
// the summary shows dropped_iterations, k6 ran out of VUs and the result is
// about k6, not the app.

import { sharedSetup, runIteration, sharedTeardown } from '../lib/scenario.js'
import { num, env } from '../lib/config.js'

const START_RPS = num('PERF_START_RPS', 5)
const MAX_RPS = num('PERF_MAX_RPS', 200)
const DURATION = env('PERF_BREAK_DURATION', '15m')
const PRE_ALLOC = num('PERF_PREALLOC_VUS', 100)
const MAX_VUS = num('PERF_MAX_VUS', 1000)

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: START_RPS,
      timeUnit: '1s',
      preAllocatedVUs: PRE_ALLOC,
      maxVUs: MAX_VUS,
      stages: [{ duration: DURATION, target: MAX_RPS }],
    },
  },
  thresholds: {
    // abortOnFail turns these into "stop here and tell me the rate".
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' }],
    rate_limited: [{ threshold: 'count<1', abortOnFail: true, delayAbortEval: '10s' }],
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
