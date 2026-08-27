// RATE LIMIT + ABUSE — the inverse of every other test here.
//
// The load tests spoof a distinct X-Forwarded-For per VU so the limiter gets
// out of the way. This one does the opposite: it presents as ONE client and
// asserts the protections actually fire. A limiter nobody tests is a limiter
// that quietly fails open — and this one already did once, when it lived in
// Edge middleware where module state does not survive between requests
// (see the comment in src/lib/rateLimit.ts).
//
//   k6 run k6/tests/rate-limit.js
//
// Uses a fixed, made-up source IP rather than the real one, so running this
// does not burn the login budget for the machine you run load tests from.
// Buckets are fixed-window; wait out the window (15 min for login, 1 min for
// read/mutation) before re-running, or restart the app to clear the
// in-process store.
//
// Note what this cannot prove: with the default in-process store, counters
// are per app instance. On a multi-instance deployment without REDIS_URL the
// effective limit is N x what you measure here. That is a real gap, and the
// app warns about it at boot rather than hiding it.

import http from 'k6/http'
import { check, group, fail } from 'k6'
import { BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, guardTarget } from '../lib/config.js'

const PROBE_IP = '198.51.100.77' // TEST-NET-2, never a real client
const H = { 'X-Forwarded-For': PROBE_IP, 'Content-Type': 'application/json' }

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
}

export function setup() {
  guardTarget()
  const health = http.get(`${BASE_URL}/api/health`)
  if (health.status !== 200) fail(`${BASE_URL}/api/health -> ${health.status}`)
  return {}
}

export default function () {
  group('unauthenticated requests are rejected', () => {
    const res = http.get(`${BASE_URL}/api/products`, { headers: H, tags: { name: 'anon_products' } })
    check(res, {
      'anonymous GET /api/products -> 401': (r) => r.status === 401,
      'no data leaked in the 401 body': (r) => !String(r.body).includes('product_id'),
    })
  })

  group('login is rate limited per IP', () => {
    // RULES.login = 8 per IP per 15 min. Deliberately a nonexistent account,
    // so the per-account bucket that also fires belongs to nobody real.
    const email = `k6-ratelimit-probe-${Date.now()}@invalid.local`
    let sawLimit = false
    let attemptsBeforeLimit = 0
    let limitRes = null

    for (let i = 0; i < 15; i++) {
      const res = http.post(
        `${BASE_URL}/api/auth/login`,
        JSON.stringify({ email, password: 'definitely-not-the-password' }),
        { headers: H, tags: { name: 'login_probe' } },
      )
      if (res.status === 429) {
        sawLimit = true
        limitRes = res
        break
      }
      attemptsBeforeLimit++
      check(res, { 'pre-limit login attempt -> 401': (r) => r.status === 401 })
    }

    check(null, {
      'login limiter fired': () => sawLimit,
      'login limiter fired within 12 attempts': () => sawLimit && attemptsBeforeLimit <= 12,
    })
    if (limitRes) {
      check(limitRes, {
        '429 carries Retry-After': (r) => !!r.headers['Retry-After'],
        '429 carries RateLimit-Limit': (r) => !!r.headers['Ratelimit-Limit'],
        '429 body does not say whether the account exists': (r) =>
          !String(r.body).toLowerCase().includes('unknown') &&
          !String(r.body).toLowerCase().includes('disabled'),
      })
    }
    console.log(`login: ${attemptsBeforeLimit} attempts allowed before 429 (rule says 8)`)
  })

  group('user enumeration is not possible', () => {
    // A known-good address and a nonexistent one must be indistinguishable in
    // BOTH status/body and timing — the login route pays an equivalent bcrypt
    // cost on a miss precisely so the timing side channel is closed. Uses a
    // separate source IP so the probes above do not poison this measurement.
    const h = { ...H, 'X-Forwarded-For': '198.51.100.78' }
    const known = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password-on-purpose' }),
      { headers: h, tags: { name: 'enum_known' } },
    )
    const unknown = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: 'nobody-at-all@invalid.local', password: 'wrong-password-on-purpose' }),
      { headers: h, tags: { name: 'enum_unknown' } },
    )

    check(null, {
      'both responses are 401': () => known.status === 401 && unknown.status === 401,
      'both responses are byte-identical': () => String(known.body) === String(unknown.body),
      // Generous bound: this is a smoke check for an obvious oracle, not a
      // statistical timing analysis. A real one needs many samples.
      'timing difference under 150ms': () =>
        Math.abs(known.timings.duration - unknown.timings.duration) < 150,
    })
  })

  group('CSRF is enforced on mutations', () => {
    const jar = new http.CookieJar()
    const h = { ...H, 'X-Forwarded-For': '198.51.100.79' }

    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      { jar, headers: h, tags: { name: 'csrf_login' } },
    )
    if (loginRes.status !== 200) {
      console.warn(`CSRF group skipped: login -> ${loginRes.status}`)
      return
    }

    // Authenticated, valid cookies, but no X-CSRF-Token header.
    const noHeader = http.post(
      `${BASE_URL}/api/products`,
      JSON.stringify({ product_name: 'k6-csrf-probe', unit_cost: 1, quantity: 1 }),
      { jar, headers: h, tags: { name: 'csrf_missing_header' } },
    )
    check(noHeader, {
      'mutation without CSRF header -> 403': (r) => r.status === 403,
      'rejection names CSRF': (r) => String(r.body).includes('CSRF'),
      'nothing was created': (r) => r.status !== 201,
    })

    // Wrong token, right shape.
    const wrongHeader = http.post(
      `${BASE_URL}/api/products`,
      JSON.stringify({ product_name: 'k6-csrf-probe', unit_cost: 1, quantity: 1 }),
      { jar, headers: { ...h, 'X-CSRF-Token': 'not-the-real-token' }, tags: { name: 'csrf_wrong_header' } },
    )
    check(wrongHeader, { 'mutation with a forged CSRF token -> 403': (r) => r.status === 403 })

    // GET must NOT require it — csrfPassed() only guards mutating verbs, and
    // requiring it on reads would break every page load.
    const read = http.get(`${BASE_URL}/api/products?limit=1`, { jar, headers: h, tags: { name: 'csrf_read' } })
    check(read, { 'GET does not require a CSRF header -> 200': (r) => r.status === 200 })
  })

  group('read endpoints are rate limited per IP', () => {
    // RULES.read = 600 per IP per minute, keyed per path. This costs 600+
    // requests; skip it with PERF_SKIP_READ_LIMIT=true when iterating.
    if (String(__ENV.PERF_SKIP_READ_LIMIT).toLowerCase() === 'true') {
      console.log('read-limit probe skipped')
      return
    }

    const jar = new http.CookieJar()
    const h = { ...H, 'X-Forwarded-For': '198.51.100.80' }
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      { jar, headers: h, tags: { name: 'read_limit_login' } },
    )
    if (loginRes.status !== 200) {
      console.warn(`read-limit group skipped: login -> ${loginRes.status}`)
      return
    }

    let allowed = 0
    let limited = false
    for (let i = 0; i < 700; i++) {
      const res = http.get(`${BASE_URL}/api/categories`, { jar, headers: h, tags: { name: 'read_limit_probe' } })
      if (res.status === 429) { limited = true; break }
      allowed++
    }
    check(null, {
      'read limiter fired before 700 requests': () => limited,
      'read limiter allowed roughly its stated 600': () => allowed >= 500 && allowed <= 650,
    })
    console.log(`read: ${allowed} requests allowed before 429 (rule says 600/min)`)
  })
}
