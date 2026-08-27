// SOAK — moderate load held for hours.
//
// Looks for what a 10-minute run cannot: slow leaks and time-dependent
// failures. In this app specifically:
//
//  - The access token expires after 15 minutes (src/lib/jwt.ts). A soak is
//    the only run that crosses that boundary, so it is the only one that
//    actually exercises POST /api/auth/refresh under load — including its
//    token ROTATION and reuse detection, which revokes every session for a
//    user if a rotated token is ever presented twice. Watch token_refreshes
//    and auth_failures: refreshes should climb steadily and auth_failures
//    should stay flat at zero.
//  - The in-process rate-limit store keeps a Map entry per key and sweeps it
//    only once a minute (src/lib/rateLimit.ts MemoryStore). Many distinct
//    spoofed client IPs over hours is exactly the shape that grows it.
//  - pg pool connection leaks: a route that throws while holding a client
//    shows up here as throughput decaying toward zero, not as an error.
//
// Uses the restock-only write mix so the catalogue does not grow during the
// run — otherwise the unbounded dashboard/lending queries get slower simply
// because there is more data, and you cannot tell that apart from a leak.
//
//   PERF_ALLOW_WRITES=true PERF_SOAK_DURATION=2h k6 run k6/tests/soak.js
//
// Watch alongside the run: RSS of the node process, `SELECT count(*) FROM
// pg_stat_activity`, and the app's own logs.

import { sharedSetup, runSoakIteration, sharedTeardown } from '../lib/scenario.js'
import { num, env } from '../lib/config.js'

const VUS = num('PERF_SOAK_VUS', 30)
const DURATION = env('PERF_SOAK_DURATION', '2h')

export const options = {
  scenarios: {
    soak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '3m', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '1m',
    },
  },
  thresholds: {
    rate_limited: ['count<1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
    // A refresh that fails is a real defect: it means a session died mid-run.
    auth_failures: ['count<1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function setup() {
  return sharedSetup()
}

export default function (state) {
  runSoakIteration(state)
}

export function teardown(state) {
  sharedTeardown(state)
}
