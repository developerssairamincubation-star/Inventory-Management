// Custom metrics shared by every flow.
//
// http_req_duration alone is not enough to judge this app: one iteration is a
// business action made of several requests, and what a user actually feels is
// the whole action. These trends measure the action; the built-ins measure
// the requests inside it.

import { Trend, Rate, Counter } from 'k6/metrics'

/** End-to-end duration of one complete business flow, tagged by flow name. */
export const flowDuration = new Trend('flow_duration', true)

/** Did the whole flow succeed (every step returned what it should)? */
export const flowSuccess = new Rate('flow_success')

/**
 * 429s received. Any non-zero value invalidates a load/stress result — it
 * means the numbers describe src/lib/rateLimit.ts rather than the app.
 */
export const rateLimited = new Counter('rate_limited')

/** 401s that forced a token refresh mid-run (access token TTL is 15 min). */
export const tokenRefreshes = new Counter('token_refreshes')

/** Auth failures that could not be recovered by a refresh. */
export const authFailures = new Counter('auth_failures')

/** 5xx responses, split out from http_req_failed so timeouts are separable. */
export const serverErrors = new Counter('server_errors')

/** Rows created, so a run can be reconciled against the cleanup script. */
export const rowsCreated = new Counter('rows_created')
