// Central config for every k6 test in this suite. Everything is env-driven so
// the same flows run against localhost, a staging container, or a preview
// deployment without editing a script.
//
// Read k6/README.md before running anything against a host you did not start
// yourself — the write flows create real rows.

import exec from 'k6/execution'

// NOTE ON NAMING: every variable here uses the PERF_ prefix, never K6_.
// `K6_` is k6's OWN reserved namespace for built-in options — K6_VUS,
// K6_DURATION, K6_ITERATIONS, K6_STAGES, K6_RPS and friends. Setting any of
// them does not just add config, it DISCARDS the entire `scenarios` block and
// replaces it with a flat constant-VU run, emitting only a single easily
// missed warning:
//
//   "env" level configuration overrode scenarios configuration entirely
//
// This suite originally used K6_VUS/K6_DURATION for its own settings, so
// every ramp, step and spike shape in k6/tests was silently thrown away and
// every run was a flat start at full concurrency. Do not reintroduce the
// prefix for anything defined here.

function env(name, fallback) {
  const v = __ENV[name]
  return v === undefined || v === '' ? fallback : v
}

function num(name, fallback) {
  const v = Number(env(name, fallback))
  return Number.isFinite(v) ? v : fallback
}

function bool(name, fallback) {
  const v = env(name, String(fallback)).toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export const BASE_URL = env('BASE_URL', 'http://localhost:4000').replace(/\/+$/, '')

// ── Credentials ──────────────────────────────────────────────────────────
// Never hardcoded. Passed in from the shell / a .env the runner sources, so
// no secret ends up in this repo or in a k6 Cloud upload. See
// k6/README.md "Credentials".
export const ADMIN_EMAIL = env('PERF_ADMIN_EMAIL', 'admin@inventory.local')
export const ADMIN_PASSWORD = env('PERF_ADMIN_PASSWORD', 'ChangeMe123!')

// Pool of seeded load-test accounts (k6/seed/load-users.sql). VUs are spread
// across these so no single account trips RULES.loginPerAccount (12 logins /
// 15 min, src/lib/rateLimit.ts). Set USER_COUNT=0 to run everything as the
// admin account instead — fine for smoke, not for anything above ~10 VUs.
export const USER_COUNT = num('PERF_USER_COUNT', 0)
export const USER_EMAIL_TEMPLATE = env('PERF_USER_EMAIL_TEMPLATE', 'k6.load{i}@loadtest.local')
export const USER_PASSWORD = env('PERF_USER_PASSWORD', 'LoadTest123!')

// ── Safety switches ──────────────────────────────────────────────────────

/** Write flows (create product/lending/invoice) only run when this is on. */
export const ALLOW_WRITES = bool('PERF_ALLOW_WRITES', false)

/** Required to point any test at a non-localhost host. */
export const ALLOW_REMOTE = bool('PERF_ALLOW_REMOTE', false)

/**
 * Each VU presents a distinct X-Forwarded-For so the app's per-IP limiter
 * (src/lib/rateLimit.ts: 600 GET/min, 120 mutations/min, per IP per path)
 * sees N clients rather than one. Without this every test above ~10 VUs
 * measures the rate limiter, not the application.
 *
 * clientIp() takes the LEFTMOST x-forwarded-for entry when
 * TRUSTED_PROXY_DEPTH is unset, which is the default — so this works
 * against a directly-exposed dev server. Behind a real proxy that appends
 * its own entry, set TRUSTED_PROXY_DEPTH on the app to match.
 *
 * Turn it OFF (PERF_SPOOF_CLIENT_IP=false) for k6/tests/rate-limit.js, which
 * exists specifically to prove the limiter fires.
 */
export const SPOOF_CLIENT_IP = bool('PERF_SPOOF_CLIENT_IP', true)

// ── Traffic mix ──────────────────────────────────────────────────────────
// Weights for pickFlow(). Roughly models the real app: staff spend most of
// their time looking at dashboards and stock lists, and issue/return items
// far less often.
export const MIX = {
  browse: num('PERF_MIX_BROWSE', 55),
  productDetail: num('PERF_MIX_PRODUCT_DETAIL', 15),
  lending: num('PERF_MIX_LENDING', 15),
  stock: num('PERF_MIX_STOCK', 8),
  invoice: num('PERF_MIX_INVOICE', 7),
}

// ── Timing ───────────────────────────────────────────────────────────────
/** Think time between a VU's iterations, seconds. Real users are not loops. */
export const THINK_MIN = num('PERF_THINK_MIN', 1)
export const THINK_MAX = num('PERF_THINK_MAX', 4)

export const RUN_ID = env('PERF_RUN_ID', `r${Date.now().toString(36)}`)

// ── Thresholds ───────────────────────────────────────────────────────────
// Deliberately per-flow rather than one global p95: a slow /api/lending
// (which loads every order in the period with no LIMIT) would otherwise hide
// behind fast /api/health calls.
export const thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  checks: ['rate>0.99'],

  'http_req_duration{endpoint:health}': ['p(95)<200'],
  'http_req_duration{endpoint:dashboard_stats}': ['p(95)<1500'],
  'http_req_duration{endpoint:products_list}': ['p(95)<1200'],
  'http_req_duration{endpoint:product_detail}': ['p(95)<800'],
  'http_req_duration{endpoint:lending_list}': ['p(95)<2500'],
  'http_req_duration{endpoint:invoices_list}': ['p(95)<2000'],
  'http_req_duration{endpoint:lending_create}': ['p(95)<2000'],
  'http_req_duration{endpoint:product_create}': ['p(95)<2000'],

  // A 429 during a load test means the run is measuring the limiter, not the
  // app. Any at all is worth failing on so the result is never misread.
  'rate_limited': ['count<1'],
}

/**
 * Refuses to run against anything that is not obviously a disposable target.
 * Called from every test's setup(). The Neon/Vercel patterns are named
 * explicitly because those are the production hosts recorded in this repo's
 * handoff notes, and a load test against them would be an outage.
 */
export function guardTarget() {
  const url = BASE_URL.toLowerCase()

  const forbidden = ['neon.tech', 'vercel.app', 'vercel.sh']
  for (const pattern of forbidden) {
    if (url.includes(pattern)) {
      exec.test.abort(
        `Refusing to load-test ${BASE_URL} — "${pattern}" is a production host for this project. ` +
          `Stand up a disposable environment instead (see k6/README.md).`,
      )
    }
  }

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)(:|\/|$)/.test(url)
  if (!isLocal && !ALLOW_REMOTE) {
    exec.test.abort(
      `BASE_URL=${BASE_URL} is not localhost. If you own this environment and it is disposable, ` +
        `re-run with PERF_ALLOW_REMOTE=true.`,
    )
  }
}

export { env, num, bool }
