// SPIKE — a sudden burst on top of a calm baseline, then back to calm.
//
// Models the real pattern for this app: a lab session ends and forty students
// queue at the counter to return equipment at once. Steady-state capacity is
// irrelevant to that; what matters is whether the burst is absorbed and, just
// as importantly, whether the app RECOVERS. The recovery plateau at the end
// is the part most people forget to include and the part that catches
// exhausted connection pools and unbounded queues.
//
//   PERF_ALLOW_WRITES=true k6 run k6/tests/spike.js
//   PERF_BASELINE=10 PERF_PEAK=400 k6 run k6/tests/spike.js
//
// Read the result as three numbers: error rate during the spike, p95 during
// the spike, and how long after the spike p95 takes to return to its
// pre-spike value.

import { sharedSetup, runIteration, sharedTeardown } from '../lib/scenario.js'
import { num, env } from '../lib/config.js'

const BASELINE = num('PERF_BASELINE', 10)
const PEAK = num('PERF_PEAK', 300)
const SPIKE_RAMP = env('PERF_SPIKE_RAMP', '20s')
const SPIKE_HOLD = env('PERF_SPIKE_HOLD', '1m')

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: BASELINE },   // settle
        { duration: '2m', target: BASELINE },   // pre-spike baseline to compare against
        { duration: SPIKE_RAMP, target: PEAK }, // the burst
        { duration: SPIKE_HOLD, target: PEAK },
        { duration: '20s', target: BASELINE },  // burst clears
        { duration: '4m', target: BASELINE },   // recovery — the part that matters
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    rate_limited: ['count<1'],
    // Errors during the spike are tolerable; errors that persist into the
    // recovery window are not. Judge that from the time series, not the
    // summary — run with --out to a time-series backend (see k6/README.md).
    http_req_failed: ['rate<0.15'],
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
